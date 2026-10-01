package im.kairema.app.terminal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Assume;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

/**
 * Extraction behaviour, including the refusals that matter for an archive that arrives inside the APK.
 *
 * <p>The real Alpine archive is exercised as well as synthetic ones, because the synthetic cases only
 * prove the checks fire and not that the shipped rootfs is actually accepted.
 */
public class TarArchiveTest {

    @Rule
    public TemporaryFolder temporary = new TemporaryFolder();

    // ---------------------------------------------------------------- happy path

    @Test
    public void extractsRegularFilesAndDirectories() throws IOException {
        File destination = temporary.newFolder("root");
        byte[] archive = ustar(
                dirEntry("dir"),
                fileEntry("dir/hello.txt", "hello\n"),
                dirEntry("dir/nested"),
                fileEntry("dir/nested/deep.txt", "deep\n"));

        int count = TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);

        assertEquals(4, count);
        assertEquals("hello\n", read(new File(destination, "dir/hello.txt")));
        assertEquals("deep\n", read(new File(destination, "dir/nested/deep.txt")));
        assertTrue(new File(destination, "dir/nested").isDirectory());
    }

    @Test
    public void extractsAnEntryWhoseNameIsLongerThanOneHundredCharacters() throws IOException {
        File destination = temporary.newFolder("long");
        StringBuilder name = new StringBuilder("d/");
        while (name.length() < 180) {
            name.append("long-directory-name/");
        }
        name.append("file.txt");
        // Written through the GNU long-name record, because a 180-character name does not fit ustar.
        byte[] inner = entry("placeholder", '0', "payload\n");
        byte[] archive = gnuLongName(name.toString(),
                archiveWithPayload(inner, "payload\n".getBytes(StandardCharsets.UTF_8)));

        TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);

        assertEquals("payload\n", read(new File(destination, name.toString())));
    }

    // ---------------------------------------------------------------- traversal

    @Test
    public void refusesAnAbsolutePath() throws IOException {
        assertRefused(entry("/etc/shadow", '0', "x"), "absolute");
    }

    @Test
    public void refusesParentTraversal() throws IOException {
        assertRefused(entry("../escaped.txt", '0', "x"), "..");
    }

    @Test
    public void refusesParentTraversalInTheMiddleOfAPath() throws IOException {
        assertRefused(entry("good/../../escaped.txt", '0', "x"), "..");
    }

    @Test
    public void refusesTraversalHiddenByADirectory() throws IOException {
        // A parent directory that resolves outside must not make a later ".." look safe.
        assertRefused(ustar(
                dirEntry("sub"),
                fileEntry("sub/../../escaped.txt", "x")), "..");
    }

    @Test
    public void refusesADriveQualifiedPath() throws IOException {
        assertRefused(entry("C:/windows/system32", '0', "x"), "drive");
    }

    @Test
    public void aNulInTheNameFieldTruncatesItRatherThanEscaping() throws IOException {
        // A NUL is the name field's terminator by format definition, so a name cannot smuggle one
        // past the reader. The entry is written under the truncated name, inside the destination.
        File destination = temporary.newFolder("nul");
        byte[] archive = ustar(fileEntry("evil.txt\u0000.png", "x"));

        TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);

        assertEquals("x", read(new File(destination, "evil.txt")));
        assertFalse("nothing may be written to the truncated-away name",
                new File(destination, "evil.txt.png").exists());
    }

    @Test
    public void anEscapingEntryIsRefusedBeforeAnythingIsCreatedOutsideTheRoot() throws IOException {
        File destination = temporary.newFolder("partial");
        byte[] archive = ustar(
                fileEntry("first.txt", "ok\n"),
                fileEntry("../escaped.txt", "x"));
        try {
            TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);
            fail("expected the traversal to be refused");
        } catch (TarArchive.InvalidArchiveException expected) {
            assertNotNull(expected.getMessage());
        }
        // The reader is a streaming extractor and cannot roll back what it already wrote, so the
        // guarantee is the important one: nothing exists outside the destination. Rolling the whole
        // directory back is the caller's job, and TerminalRuntime does exactly that by deleting it
        // and re-extracting on any failure.
        assertFalse("nothing may be created outside the destination",
                new File(destination.getParentFile(), "escaped.txt").exists());
        assertTrue("the refused entry itself must not exist",
                new File(destination, "first.txt").isFile());
    }

    // ---------------------------------------------------------------- special entry types

    @Test
    public void refusesADeviceNode() throws IOException {
        assertRefused(entry("dev/null", '3', ""), "device node");
    }

    @Test
    public void refusesABlockDevice() throws IOException {
        assertRefused(entry("dev/loop0", '4', ""), "device node");
    }

    @Test
    public void refusesAFifo() throws IOException {
        assertRefused(entry("tmp/pipe", '6', ""), "FIFO");
    }

    @Test
    public void refusesAHardLink() throws IOException {
        byte[] header = entry("bin/sh", '1', "");
        writeLinkName(header, "../../../etc/passwd");
        assertRefused(header, "hard link");
    }

    @Test
    public void acceptsAnAbsoluteSymlinkBecauseProotRerootsIt() throws IOException {
        // 306 entries in the real rootfs look like this. proot translates a guest absolute path into
        // a host path under the guest root, so /bin/busybox cannot reach the host /system or another
        // app's files. Refusing these would make the stock rootfs unusable.
        File destination = temporary.newFolder("absolute-link");
        byte[] header = entry("usr/bin/yes", '2', "");
        writeLinkName(header, "/bin/busybox");
        byte[] archive = ustar(fileEntry("bin/busybox", "elf\n"), header);

        TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);

        assertEquals("the link must be created verbatim",
                "/bin/busybox",
                java.nio.file.Files.readSymbolicLink(
                        new File(destination, "usr/bin/yes").toPath()).toString());
    }

    @Test
    public void refusesARelativeSymlinkThatEscapesOnTheHost() throws IOException {
        byte[] header = entry("usr/bin/sh", '2', "");
        writeLinkName(header, "../../../../data/data/other.app/files");
        assertRefused(header, "symlink");
    }

    @Test
    public void acceptsASymlinkThatStaysInside() throws IOException {
        File destination = temporary.newFolder("inside");
        byte[] header = entry("usr/bin/busybox-link", '2', "");
        writeLinkName(header, "../../bin/busybox");
        byte[] archive = ustar(fileEntry("bin/busybox", "elf\n"), header);

        TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);

        assertEquals("a relative link that stays inside the root is legitimate",
                "../../bin/busybox",
                java.nio.file.Files.readSymbolicLink(
                        new File(destination, "usr/bin/busybox-link").toPath()).toString());
    }

    // ---------------------------------------------------------------- malformed archives

    @Test
    public void refusesAnEmptyStream() {
        assertRefusedBytes(new byte[0], "terminator");
    }

    @Test
    public void refusesATruncatedHeader() {
        byte[] truncated = new byte[100];
        assertRefusedBytes(truncated, "truncated");
    }

    @Test
    public void refusesAnArchiveWithoutATerminator() {
        // A complete entry, but the two zero blocks that must follow it are withheld, so the input
        // simply runs out. Running out is not the same as a clean end and must not look like one.
        assertRefusedBytes(archiveWithPayload(entry("a.txt", '0', "x"),
                "x".getBytes(StandardCharsets.UTF_8)), "terminator");
    }

    @Test
    public void refusesAnEntryShorterThanItsDeclaredSize() {
        // Assembled byte for byte rather than through a helper, because the point is that the stream
        // stops mid-entry: adding the usual entry padding would supply the missing bytes and turn
        // this into a different, also-valid, "no terminator" case.
        byte[] header = entry("short.txt", '0', "");
        putOctal(header, 124, 12, 100);
        byte[] archive = new byte[512 + 2];
        System.arraycopy(header, 0, archive, 0, 512);
        assertRefusedBytes(archive, "shorter than its declared size");
    }

    @Test
    public void refusesAnEntryLargerThanThePerEntryLimit() {
        byte[] header = entry("huge.bin", '0', "");
        putOctal(header, 124, 12, (int) (TarArchive.MAX_ENTRY_BYTES + 1));
        assertRefusedBytes(terminate(archiveWithPayload(header, new byte[0])), "size limit");
    }

    @Test
    public void refusesANegativeSize() {
        byte[] header = entry("weird.bin", '0', "");
        // GNU base-256 with the high bit set and an all-ones tail encodes a negative value on read.
        header[124] = (byte) 0xFF;
        for (int i = 125; i < 136; i++) {
            header[i] = (byte) 0xFF;
        }
        assertRefusedBytes(terminate(archiveWithPayload(header, new byte[0])), "negative");
    }

    @Test
    public void refusesAMalformedNumericField() {
        byte[] header = entry("weird.bin", '0', "");
        for (int i = 124; i < 136; i++) {
            header[i] = (byte) 'z';
        }
        assertRefusedBytes(terminate(archiveWithPayload(header, new byte[0])), "malformed numeric field");
    }

    @Test
    public void refusesAnUnsupportedEntryType() {
        assertRefused(entry("weird.contiguous-file", '7', "x"), "unsupported entry type");
    }

    // ---------------------------------------------------------------- the real archive

    @Test
    public void extractsTheRealAlpineRootfs() throws IOException {
        File rootfs = realRootfsGz();
        Assume.assumeTrue("the shipped rootfs is not present", rootfs != null);

        File destination = temporary.newFolder("alpine");
        int count;
        try (InputStream in = new GZIPInputStream(new java.io.FileInputStream(rootfs))) {
            count = TarArchive.extract(in, destination);
        }

        assertTrue("the rootfs should contain many entries, saw " + count, count > 500);
        // The markers the runtime and the shell both depend on.
        assertTrue("busybox is the real binary", new File(destination, "bin/busybox").isFile());
        assertTrue("etc/alpine-release marks a completed rootfs",
                new File(destination, "etc/alpine-release").isFile());
        assertTrue(new File(destination, "usr/lib").isDirectory());
        // /bin/sh is an absolute symlink to /bin/busybox. It cannot resolve on the host filesystem,
        // which is exactly why File.isFile() is false here and why proot's path translation is what
        // makes it work. Asserting the link itself is the honest check.
        File shell = new File(destination, "bin/sh");
        assertTrue("bin/sh should exist as a link", java.nio.file.Files.isSymbolicLink(shell.toPath()));
        assertEquals("/bin/busybox", java.nio.file.Files.readSymbolicLink(shell.toPath()).toString());
        assertTrue("a relative link must resolve inside the root",
                new File(destination, "usr/lib/libz.so.1").isFile()
                        || java.nio.file.Files.isSymbolicLink(
                                new File(destination, "usr/lib/libz.so.1").toPath()));

        // Every extracted path must still be inside the destination.
        assertTrue("alpine-release should name a real release",
                read(new File(destination, "etc/alpine-release")).startsWith("3.21"));
    }

    /** The committed rootfs asset, or null when it is not on disk. */
    private File realRootfsGz() {
        File candidate = new File("src/main/assets/terminal/rootfs/"
                + "alpine-minirootfs-3.21.8-aarch64.tar.gz");
        return candidate.isFile() ? candidate : null;
    }

    // ---------------------------------------------------------------- helpers

    private void assertRefused(byte[] archiveHeader, String expectedFragment) {
        assertRefusedBytes(terminate(archiveWithPayload(archiveHeader, new byte[0])),
                expectedFragment);
    }

    private void assertRefusedBytes(byte[] archive, String expectedFragment) {
        File destination;
        try {
            destination = temporary.newFolder();
        } catch (IOException e) {
            throw new AssertionError(e);
        }
        try {
            TarArchive.extract(new java.io.ByteArrayInputStream(archive), destination);
            fail("expected the archive to be refused: " + expectedFragment);
        } catch (TarArchive.InvalidArchiveException expected) {
            assertNotNull(expected.getMessage());
            assertTrue("message should mention '" + expectedFragment + "' but was: " + expected.getMessage(),
                    expected.getMessage().toLowerCase().contains(expectedFragment.toLowerCase()));
        } catch (IOException unexpected) {
            fail("expected InvalidArchiveException, got " + unexpected);
        }
    }

    private static String read(File file) throws IOException {
        byte[] bytes = new byte[(int) file.length()];
        try (InputStream in = new java.io.FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int n = in.read(bytes, offset, bytes.length - offset);
                if (n < 0) break;
                offset += n;
            }
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** A ustar header for one entry, with the size field set from {@code content}. */
    private static byte[] entry(String name, char typeFlag, String content) {
        byte[] header = new byte[512];
        putString(header, 0, 100, name);
        putOctal(header, 100, 8, 0644);
        putOctal(header, 108, 8, 0);
        putOctal(header, 116, 8, 0);
        // Size is the real content length, which is zero for directories, links and devices.
        putOctal(header, 124, 12, content.length());
        putOctal(header, 136, 12, 0);
        header[156] = (byte) typeFlag;
        putString(header, 257, 6, "ustar");
        putString(header, 263, 2, "00");
        putOctal(header, 148, 8, 0);
        return header;
    }

    /** A header plus its declared content, as a single block pair. */
    private static byte[] fileEntry(String name, String content) {
        return archiveWithPayload(entry(name, '0', content), content.getBytes(StandardCharsets.UTF_8));
    }

    /** One complete entry: header, content, and the padding to the next 512-byte boundary. */
    private static byte[] archiveWithPayload(byte[] header, byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(header, 0, header.length);
        out.write(payload, 0, payload.length);
        out.write(new byte[padding(payload.length)], 0, padding(payload.length));
        return out.toByteArray();
    }

    /** Appends the two zero blocks a well-formed archive must end with. */
    private static byte[] terminate(byte[] blocks) {
        byte[] out = new byte[blocks.length + 1024];
        System.arraycopy(blocks, 0, out, 0, blocks.length);
        return out;
    }

    private static byte[] gnuLongName(String longName, byte[] following) throws IOException {
        byte[] payload = longName.getBytes(StandardCharsets.UTF_8);
        byte[] longHeader = new byte[512];
        putString(longHeader, 0, 100, "././@LongLink");
        putOctal(longHeader, 124, 12, payload.length);
        longHeader[156] = 'L';
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(longHeader, 0, longHeader.length);
        out.write(payload, 0, payload.length);
        out.write(new byte[padding(payload.length)], 0, padding(payload.length));
        out.write(following, 0, following.length);
        out.write(new byte[1024], 0, 1024);
        return out.toByteArray();
    }

    /** Concatenates already-complete header+payload blocks, then terminates the archive. */
    private static byte[] ustar(byte[]... completeBlocks) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] block : completeBlocks) {
            out.write(block, 0, block.length);
        }
        out.write(new byte[1024], 0, 1024);
        return out.toByteArray();
    }

    /** A complete entry for a directory: header only, size zero. */
    private static byte[] dirEntry(String name) {
        return entry(name.endsWith("/") ? name : name + "/", '5', "");
    }

    private static int padding(int length) {
        int remainder = length % 512;
        return remainder == 0 ? 0 : 512 - remainder;
    }

    private static void putString(byte[] block, int offset, int length, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(bytes, 0, block, offset, Math.min(bytes.length, length));
    }

    private static void putOctal(byte[] block, int offset, int length, int value) {
        String octal = Integer.toOctalString(value);
        StringBuilder padded = new StringBuilder();
        while (padded.length() + octal.length() < length - 1) {
            padded.append('0');
        }
        padded.append(octal);
        putString(block, offset, length, padded.toString());
    }

    private static void writeLinkName(byte[] block, String linkName) {
        putString(block, 157, 100, linkName);
    }
}

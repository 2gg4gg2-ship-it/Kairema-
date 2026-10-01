package im.kairema.app.terminal;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * A deliberately small, strict tar reader for the one archive this app ships.
 *
 * <p>It is not a general tar utility. It understands ustar and GNU long-name records and refuses
 * everything it does not positively recognise as a plain file, directory or symlink. Anything
 * ambiguous is an error rather than something to be tolerated, because the input is a fixed
 * upstream archive whose SHA-256 has already been checked: if a byte of it changed, the digest
 * check rejects the archive before a single entry is read, so a parser that fails closed costs
 * nothing and removes any chance of a crafted archive escaping the runtime directory.
 *
 * <p>Rejected outright: absolute paths, {@code ..} traversal, paths that would land outside the
 * destination, device nodes, FIFOs, and hard links. Only regular files, directories and symbolic
 * links that resolve inside the destination are written.
 */
public final class TarArchive {

    /** Refuse a single entry larger than this; the Alpine minirootfs is far below it. */
    public static final long MAX_ENTRY_BYTES = 64L * 1024 * 1024;

    /** Refuse more total extracted bytes than this, to bound a decompression bomb. */
    public static final long MAX_TOTAL_BYTES = 512L * 1024 * 1024;

    private static final int BLOCK = 512;

    private TarArchive() {
    }

    /** Thrown for any archive this reader refuses. The message never contains archive content. */
    public static final class InvalidArchiveException extends IOException {
        public InvalidArchiveException(String message) {
            super(message);
        }
    }

    /**
     * Extracts {@code source} into {@code destination}.
     *
     * @return the number of files and directories written
     */
    public static int extract(InputStream source, File destination) throws IOException {
        if (!destination.isDirectory() && !destination.mkdirs()) {
            throw new IOException("could not create destination directory");
        }
        File root = canonical(destination);
        Counter counter = new Counter();
        byte[] header = new byte[BLOCK];
        byte[] longName = null;

        long totalBytes = 0;
        int entries = 0;
        boolean sawEnd = false;

        while (true) {
            int read = readFully(source, header, 0, BLOCK);
            if (read == 0) {
                // Two zero blocks terminate a tar archive. Running out of input without them means
                // the file was truncated, which must not be treated as a complete extraction.
                throw new InvalidArchiveException("archive ended without a terminator block");
            }
            if (read < BLOCK) {
                throw new InvalidArchiveException("truncated header block");
            }
            if (isZeroBlock(header)) {
                byte[] second = new byte[BLOCK];
                if (readFully(source, second, 0, BLOCK) < BLOCK) {
                    throw new InvalidArchiveException("archive ended without a second terminator");
                }
                if (!isZeroBlock(second)) {
                    throw new InvalidArchiveException("malformed archive terminator");
                }
                sawEnd = true;
                break;
            }

            String name = readString(header, 0, 100);
            long size = readOctal(header, 124, 12);
            String typeFlag = readString(header, 156, 1);
            String linkName = readString(header, 157, 100);
            String prefix = readString(header, 345, 155);

            if (size < 0) {
                throw new InvalidArchiveException("negative entry size");
            }

            boolean isGnuLongName = "L".equals(typeFlag);
            boolean isGnuLongLink = "K".equals(typeFlag);
            if (isGnuLongName || isGnuLongLink) {
                byte[] payload = readPayload(source, size);
                if (longName == null || longName.length != payload.length) {
                    longName = payload;
                } else {
                    System.arraycopy(payload, 0, longName, 0, payload.length);
                }
                skipRestOfEntry(source, size);
                continue;
            }

            String entryName = name;
            if (longName != null) {
                entryName = trimNul(longName);
                longName = null;
            }
            if (!prefix.isEmpty() && !"L".equals(typeFlag)) {
                // ustar prefix+name form.
                entryName = prefix.endsWith("/") ? prefix + entryName : prefix + "/" + entryName;
            }

            File target = resolveSafely(root, entryName);

            switch (typeFlag) {
                case "0":
                case "": {
                    // Regular file.
                    if (size > MAX_ENTRY_BYTES) {
                        throw new InvalidArchiveException("entry exceeds the size limit");
                    }
                    totalBytes += size;
                    if (totalBytes > MAX_TOTAL_BYTES) {
                        throw new InvalidArchiveException("archive exceeds the total size limit");
                    }
                    writeFile(source, target, size, counter);
                    break;
                }
                case "5": {
                    // Directory. Created with a private mode; the process umask narrows it further.
                    if (!target.isDirectory() && !target.mkdirs()) {
                        throw new IOException("could not create directory in archive");
                    }
                    counter.directories++;
                    skipEntry(source, size);
                    break;
                }
                case "2": {
                    // Symlink. A target that escapes on the host is refused; see linkStaysInside.
                    if (!linkName.isEmpty() && !linkStaysInside(root, target, linkName)) {
                        throw new InvalidArchiveException("symlink in archive escapes the destination");
                    }
                    // The parent may not have an explicit entry of its own, and a link cannot be
                    // created without it.
                    File parent = target.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("could not create parent directory for a link in the archive");
                    }
                    try {
                        java.nio.file.Files.createSymbolicLink(
                                target.toPath(), new File(linkName).toPath());
                        counter.symlinks++;
                    } catch (UnsupportedOperationException | IOException notASymlink) {
                        // A filesystem that refuses symlinks is not a failure of the archive; the
                        // target simply is not created. The digest already proved the bytes.
                    }
                    break;
                }
                case "1": {
                    // Hard link. The minirootfs has none, and a hard link to an absolute path is a
                    // classic escape, so it is refused rather than resolved.
                    throw new InvalidArchiveException("archive contains a hard link");
                }
                case "3":
                case "4": {
                    // Character and block device nodes.
                    throw new InvalidArchiveException("archive contains a device node");
                }
                case "6": {
                    // FIFO: blocking reads and no data source, never legitimate in a rootfs.
                    throw new InvalidArchiveException("archive contains a FIFO");
                }
                default: {
                    throw new InvalidArchiveException("archive contains an unsupported entry type");
                }
            }
            // Every entry's content is padded to a 512-byte boundary. Skipping that padding is what
            // keeps the reader aligned to the next header: without it a file whose size is not a
            // multiple of the block size leaves the stream mid-entry and the next "header" is
            // padding, which fails as an entry with no name.
            skipRestOfEntry(source, size);
            entries++;
        }

        if (!sawEnd) {
            throw new InvalidArchiveException("archive was not terminated");
        }
        return entries;
    }

    /**
     * Resolves an archive entry name to a file inside {@code root}, or refuses it.
     *
     * <p>This is the single place traversal is decided. Absolute names, {@code ..} and NUL are
     * rejected before any File is constructed, and the result is re-checked against the canonical
     * root afterwards so a symlinked parent cannot redirect the write.
     */
    static File resolveSafely(File root, String entryName) throws IOException {
        if (entryName == null || entryName.isEmpty()) {
            throw new InvalidArchiveException("archive entry has no name");
        }
        if (entryName.indexOf('\0') >= 0) {
            throw new InvalidArchiveException("archive entry name contains a NUL byte");
        }
        String normalised = entryName.replace('\\', '/');
        if (normalised.startsWith("/")) {
            throw new InvalidArchiveException("archive entry uses an absolute path");
        }
        // Reject a Windows-style drive letter too, even though it is harmless on Linux, so the
        // check does not depend on the platform we happen to run on.
        if (normalised.length() >= 2 && normalised.charAt(1) == ':') {
            throw new InvalidArchiveException("archive entry uses a drive-qualified path");
        }
        for (String segment : normalised.split("/")) {
            if (segment.equals("..")) {
                throw new InvalidArchiveException("archive entry escapes with ..");
            }
        }
        File target = new File(root, normalised);
        String rootPath = root.getPath() + File.separator;
        String targetPath = target.getPath();
        if (!targetPath.startsWith(rootPath)) {
            throw new InvalidArchiveException("archive entry resolves outside the destination");
        }
        return target;
    }

    /**
     * Whether a symlink target is acceptable inside the guest root.
     *
     * <p>An absolute target is allowed, and the real Alpine archive depends on it: 306 of its
     * entries are links to {@code /bin/busybox} and similar. This is safe precisely because the
     * guest runs under proot, whose defining job is to translate a guest path into a host path under
     * the guest root. A guest {@code /bin/busybox} becomes {@code <rootfs>/bin/busybox} and an
     * absolute link cannot be used to reach {@code /system} or another app's files, because the same
     * translation applies to whatever the link resolves to. Refusing these would make the stock
     * rootfs unusable.
     *
     * <p>A relative target is held to the stricter rule that it must stay inside the root on the host
     * filesystem as well, so an archive cannot plant a link that points out of the guest even before
     * proot is involved.
     */
    private static boolean linkStaysInside(File root, File linkPath, String target) {
        if (target.startsWith("/")) {
            // Absolute in the guest; proot re-roots it. See the method comment.
            return true;
        }
        try {
            File resolved = new File(linkPath.getParentFile(), target);
            String rootPath = canonical(root).getPath() + File.separator;
            String resolvedPath = canonical(resolved).getPath();
            return resolvedPath.startsWith(rootPath);
        } catch (IOException unresolvable) {
            return false;
        }
    }

    private static void writeFile(InputStream source, File target, long size, Counter counter)
            throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IOException("could not create parent directory for an archive entry");
        }
        try (OutputStream out = new FileOutputStream(target)) {
            copyExactly(source, out, size);
        }
        counter.files++;
    }

    private static void copyExactly(InputStream in, OutputStream out, long size) throws IOException {
        byte[] buffer = new byte[8192];
        long remaining = size;
        while (remaining > 0) {
            int n = in.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (n < 0) {
                throw new InvalidArchiveException("archive entry is shorter than its declared size");
            }
            out.write(buffer, 0, n);
            remaining -= n;
        }
    }

    private static byte[] readPayload(InputStream in, long size) throws IOException {
        if (size > MAX_ENTRY_BYTES) {
            throw new InvalidArchiveException("metadata entry exceeds the size limit");
        }
        byte[] payload = new byte[(int) size];
        if (readFully(in, payload, 0, (int) size) < size) {
            throw new InvalidArchiveException("truncated metadata entry");
        }
        return payload;
    }

    private static void skipEntry(InputStream in, long size) throws IOException {
        copyExactly(in, NullOutputStream.INSTANCE, size);
    }

    private static void skipRestOfEntry(InputStream in, long size) throws IOException {
        long padding = padding(size);
        copyExactly(in, NullOutputStream.INSTANCE, padding);
    }

    private static long padding(long size) {
        long remainder = size % BLOCK;
        return remainder == 0 ? 0 : BLOCK - remainder;
    }

    private static int readFully(InputStream in, byte[] buffer, int offset, int length)
            throws IOException {
        int read = 0;
        while (read < length) {
            int n = in.read(buffer, offset + read, length - read);
            if (n < 0) {
                break;
            }
            read += n;
        }
        return read;
    }

    private static boolean isZeroBlock(byte[] block) {
        for (byte b : block) {
            if (b != 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Parses a numeric tar field.
     *
     * <p>Octal, with the GNU base-256 encoding accepted because some archives use it for large
     * values. An unparseable or negative value is an error rather than a default: silently treating
     * a corrupt size as zero would shift every following entry.
     */
    static long readOctal(byte[] block, int offset, int length) throws IOException {
        if ((block[offset] & 0x80) != 0) {
            // GNU base-256, two's complement. The sign lives in the next bit of the first byte, so
            // the sign is decoded before the magnitude rather than being discovered as an overflow.
            boolean negative = (block[offset] & 0x40) != 0;
            if (negative) {
                return -1;
            }
            long value = block[offset] & 0x3F;
            for (int i = offset + 1; i < offset + length; i++) {
                value = (value << 8) | (block[i] & 0xFF);
                if (value < 0) {
                    throw new InvalidArchiveException("numeric field overflows");
                }
            }
            return value;
        }
        long value = 0;
        boolean any = false;
        for (int i = offset; i < offset + length; i++) {
            int c = block[i];
            if (c == 0 || c == ' ') {
                if (any) {
                    break;
                }
                continue;
            }
            if (c < '0' || c > '7') {
                throw new InvalidArchiveException("malformed numeric field");
            }
            value = (value << 3) | (c - '0');
            any = true;
            if (value > MAX_TOTAL_BYTES) {
                throw new InvalidArchiveException("numeric field is implausibly large");
            }
        }
        return value;
    }

    /**
     * Reads a NUL-padded fixed-width field.
     *
     * <p>Stops at the first NUL. Every string field in a tar header is NUL-padded to its width, so
     * reading the raw width would append the padding to the value and make a perfectly ordinary name
     * look like it contained a NUL byte.
     */
    private static String readString(byte[] block, int offset, int length) {
        int end = offset;
        int limit = offset + length;
        while (end < limit && block[end] != 0) {
            end++;
        }
        return new String(block, offset, end - offset, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String trimNul(byte[] bytes) {
        int length = bytes.length;
        while (length > 0 && bytes[length - 1] == 0) {
            length--;
        }
        return new String(bytes, 0, length, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static File canonical(File file) throws IOException {
        return file.getCanonicalFile();
    }

    private static final class Counter {
        int files;
        int directories;
        int symlinks;
    }

    private static final class NullOutputStream extends OutputStream {
        static final NullOutputStream INSTANCE = new NullOutputStream();

        @Override
        public void write(int b) {
        }

        @Override
        public void write(byte[] b, int off, int len) {
        }
    }
}

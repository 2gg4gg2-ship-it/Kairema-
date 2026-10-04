package im.kairema.app.terminal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Removal of a previously installed rootfs.
 *
 * <p>The tree that gets removed is the one the install step itself produced, so it carries the
 * property that made a naive removal fail: it is full of symlinks whose targets are absolute paths
 * inside the guest, such as {@code /bin/busybox}. Those paths mean nothing on the Android host, so
 * every one of them is a dangling link.
 */
public class TerminalRuntimeDeleteTest {

    /**
     * A dangling link is still a directory entry that has to be unlinked. Asking whether it
     * "exists" in the {@link File#exists()} sense asks about its target instead, reports false, and
     * skips it. Its parent then never empties, and so the rootfs directory itself can never be
     * removed.
     *
     * <p>This is the shape of the Alpine rootfs, and the reason installation reported
     * {@code install_root} / {@code mkdir_runtime_dir}: the leftover tree made {@code mkdirs()}
     * return false because the directory was already there.
     */
    @Test
    public void removesTreeHoldingDanglingAbsoluteSymlinks() throws Exception {
        Path root = Files.createTempDirectory("kairema-terminal-delete");
        try {
            File bin = new File(root.toFile(), "bin");
            assertTrue("the bin directory should have been created", bin.mkdirs());
            // The real file those links are meant to reach, next to two that reach nothing.
            assertTrue(new File(bin, "busybox").createNewFile());
            Files.createSymbolicLink(new File(bin, "sh").toPath(), Paths.get("/bin/busybox"));
            Files.createSymbolicLink(new File(bin, "ls").toPath(), Paths.get("/usr/bin/busybox"));

            File usrBin = new File(root.toFile(), "usr/bin");
            assertTrue(usrBin.mkdirs());
            // A relative link out of the tree, as rootfs links between directories are.
            Files.createSymbolicLink(new File(usrBin, "vi").toPath(),
                    Paths.get("../../bin/busybox"));

            int deleted = deleteRecursively(root.toFile());

            assertFalse("a tree of dangling links must still be removable; something is left at "
                    + root, entryExists(root.toFile()));
            assertEquals("root, bin, bin/busybox, bin/sh, bin/ls, usr, usr/bin, usr/bin/vi",
                    8, deleted);
        } finally {
            deleteRecursively(root.toFile());
        }
    }

    /**
     * The ordinary case, kept separate so a regression in the dangling-link handling cannot hide
     * behind it, and the other way round.
     */
    @Test
    public void removesOrdinaryTreeAndCountsWhatItRemoved() throws Exception {
        Path root = Files.createTempDirectory("kairema-terminal-delete-plain");
        try {
            File etc = new File(root.toFile(), "etc");
            assertTrue(etc.mkdirs());
            assertTrue(new File(etc, "passwd").createNewFile());
            assertTrue(new File(root.toFile(), "marker").createNewFile());

            assertEquals("root, etc, etc/passwd, marker", 4, deleteRecursively(root.toFile()));
            assertFalse("the tree should be gone", entryExists(root.toFile()));
        } finally {
            deleteRecursively(root.toFile());
        }
    }

    /**
     * Removing something that is not there is not an error. Installation relies on that to clear a
     * directory it has never created, such as on a first run.
     */
    @Test
    public void removingAnAbsentPathRemovesNothing() throws Exception {
        Path root = Files.createTempDirectory("kairema-terminal-delete-absent");
        try {
            assertEquals(0, deleteRecursively(new File(root.toFile(), "never-installed")));
            assertTrue("the parent must be left alone", entryExists(root.toFile()));
        } finally {
            deleteRecursively(root.toFile());
        }
    }

    /**
     * Existence without following a link, which is the only question that describes a directory
     * entry rather than what it points at.
     */
    private static boolean entryExists(File file) {
        return Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS);
    }

    /**
     * {@code deleteRecursively} is private because it is an implementation detail of installation,
     * which is the right default. Reaching it reflectively keeps it that way while still pinning the
     * behaviour installation depends on.
     */
    private static int deleteRecursively(File file) throws Exception {
        Method method = TerminalRuntime.class.getDeclaredMethod("deleteRecursively", File.class);
        method.setAccessible(true);
        return (Integer) method.invoke(null, file);
    }
}
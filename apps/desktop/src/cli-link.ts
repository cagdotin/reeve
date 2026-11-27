/**
 * Puts the `reeve` the app ships on the PATH: an app installed in an Applications
 * folder links `~/.local/bin/reeve` to it, unless a reeve that works is already there.
 */
import { access, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Whether `bundle` is installed, rather than run from a download or a test folder. */
export const isInstalled = (bundle: string, home: string) =>
  [join(home, "Applications"), "/Applications"].includes(dirname(bundle));

/**
 * Links `<home>/.local/bin/reeve` to the app's `reeve` when no reeve is there, or the one there is a
 * link to an app that is gone. Any other reeve (a checkout's `bin/reeve`, a file) is left alone.
 */
export const linkCli = async (bundle: string, home: string) => {
  const link = join(home, ".local/bin/reeve");
  const present = await lstat(link).then(
    () => true,
    () => false,
  );
  const works = await access(link).then(
    () => true,
    () => false,
  );
  if (works) return;
  if (present) await rm(link);
  await mkdir(dirname(link), { recursive: true });
  await symlink(join(bundle, "Contents/Resources/bin/reeve"), link);
};

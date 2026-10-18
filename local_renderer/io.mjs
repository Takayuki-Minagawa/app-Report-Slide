import {
  lstat,
  stat,
  realpath,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
} from 'node:fs/promises';
import {
  dirname,
  resolve,
  relative,
  isAbsolute,
  basename,
  join,
  sep,
} from 'node:path';

export const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};

export async function readAsset(root, source, maxBytes) {
  if (/^[a-z][a-z\d+.-]*:|^[/\\]/i.test(source))
    throw new Error(`Asset must be relative to --assets-dir: ${source}`);
  const raw = source.split(/[?#]/, 1)[0];
  let path = resolve(root, raw);
  if (!inside(root, path))
    throw new Error(`Asset escapes --assets-dir: ${source}`);
  try {
    await stat(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    path = resolve(root, decodeURIComponent(raw));
  }
  if (!inside(root, path))
    throw new Error(`Asset escapes --assets-dir: ${source}`);
  const actual = await realpath(path);
  if (!inside(root, actual))
    throw new Error(`Asset symlink escapes --assets-dir: ${source}`);
  const info = await stat(actual);
  if (!info.isFile() || info.size > maxBytes)
    throw new Error(
      `Asset is not a file or exceeds ${maxBytes} bytes: ${source}`,
    );
  const bytes = await readFile(actual);
  if (bytes.length > maxBytes)
    throw new Error(`Asset exceeds ${maxBytes} bytes: ${source}`);
  return { path: actual, relative: relative(root, path), bytes };
}

async function canonicalOutput(path) {
  let parent = dirname(path),
    tail = [basename(path)];
  for (;;) {
    try {
      return join(await realpath(parent), ...tail);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      tail.unshift(basename(parent));
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

/** Detect aliases before any write, including symlinks and existing hard links. */
export async function checkDestinations(
  outputs,
  protectedPaths,
  legacyJsonInput,
) {
  const identities = await Promise.all(
    protectedPaths.map(async (path) => {
      const info = await stat(path);
      return {
        path: await realpath(path),
        identity: `${info.dev}:${info.ino}`,
      };
    }),
  );
  const seen = [];
  for (const output of outputs) {
    const path = await canonicalOutput(output.path);
    let info;
    try {
      info = await lstat(output.path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new Error(
        `Output must be a regular file, not a directory or symlink: ${output.path}`,
      );
    const identity = info && `${info.dev}:${info.ino}`;
    const key = path.normalize('NFC').toLowerCase();
    for (const previous of seen) {
      if (
        previous.key === key ||
        inside(previous.key, key) ||
        inside(key, previous.key) ||
        (identity && previous.identity === identity)
      )
        throw new Error(
          `Output paths overlap: ${previous.path} and ${output.path}`,
        );
    }
    seen.push({ path: output.path, key, identity });
    for (const source of identities) {
      const same =
        source.path.normalize('NFC').toLowerCase() === key ||
        source.identity === identity;
      if (!same) continue;
      // Compatibility: old callers explicitly request normalization back into JSON input.
      if (
        output.kind === 'json' &&
        legacyJsonInput &&
        path === legacyJsonInput &&
        source.path === legacyJsonInput
      )
        continue;
      throw new Error(
        `Output would overwrite an input or asset: ${output.path}`,
      );
    }
  }
}

/** Stage every file first, then publish; restore previous files if a commit fails. */
export async function writeOutputs(outputs) {
  const staged = [];
  try {
    for (const output of outputs) {
      await mkdir(dirname(output.path), { recursive: true });
      const temp = await mkdtemp(join(dirname(output.path), '.kumi-stage-'));
      const record = {
        ...output,
        temp,
        staged: join(temp, 'new'),
        backup: join(temp, 'old'),
        published: false,
        backedUp: false,
      };
      staged.push(record);
      await writeFile(record.staged, output.content, { flag: 'wx' });
    }
    for (const record of staged) {
      try {
        await rename(record.path, record.backup);
        record.backedUp = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await rename(record.staged, record.path);
      record.published = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const record of staged.toReversed()) {
      try {
        if (record.published) await rm(record.path);
        if (record.backedUp) await rename(record.backup, record.path);
      } catch (rollbackError) {
        rollbackErrors.push(
          `${record.path}: ${rollbackError.message}; backup: ${record.backup}`,
        );
      }
    }
    if (rollbackErrors.length) {
      throw new Error(
        `${error.message}; rollback failed: ${rollbackErrors.join('; ')}`,
      );
    }
    throw error;
  } finally {
    // Never remove a backup that could not be restored.
    for (const record of staged) {
      let backupExists = false;
      try {
        await stat(record.backup);
        backupExists = true;
      } catch {
        /* absent */
      }
      if (!backupExists || staged.every((item) => item.published))
        await rm(record.temp, { recursive: true, force: true });
    }
  }
}

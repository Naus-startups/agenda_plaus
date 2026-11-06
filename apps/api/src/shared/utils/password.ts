import bcrypt from "bcrypt";

/*
 * Native bcrypt: each hash runs on libuv's thread pool, so logins and sign-ups use several
 * cores and leave the event loop free for the other requests (bcryptjs computed them in
 * JavaScript, on the one thread that serves everything). Hashes are the same format, so
 * every password stored by bcryptjs still verifies.
 */
const COST = 10;

export function hashPassword(password: string, cost: number = COST): Promise<string> {
  return bcrypt.hash(password, cost);
}

export function hashPasswordSync(password: string, cost: number = COST): string {
  return bcrypt.hashSync(password, cost);
}

// $2y$ (PHP's prefix) is the same algorithm as $2b$; bcryptjs accepted it, native bcrypt
// doesn't, so an imported hash would otherwise stop matching.
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash.startsWith("$2y$") ? `$2b$${hash.slice(4)}` : hash);
}

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/shared/utils/password";

// Hashes produced by bcryptjs (the library before native bcrypt), kept here so the accounts
// already in the database are proven to keep signing in without bcryptjs installed.
const STORED_BY_BCRYPTJS = [
  { password: "Password123!", hash: "$2b$04$n2zZ/LwkvlH.cxAjnXNVKe8u3cXchjfYFst/yPaeHW7rKvzJTRl7C" },
  // bcryptjs 2.x wrote $2a$; for passwords under 255 bytes it's the same hash as $2b$.
  { password: "Password123!", hash: "$2a$04$H8tETF9tSKIDVADKx7Mc.O1EU4NR6bJIrlpDqJbljdFzS0rg7WFo." },
  { password: "Palavra-passe São João € 🔐", hash: "$2b$04$vvCZKL6SQoE2Sn8bc0zDeOAXQIxZeyYu4g4KZgrtrhj.5AiI7kNZW" },
  { password: "x".repeat(100), hash: "$2b$04$yCa2DgQ5CSotJTGChxmFxeBeGeivYGrM.nfYr2N9iTwNh9poM6rza" },
  // PHP's prefix, which bcryptjs accepted too.
  { password: "Password123!", hash: "$2y$04$bAmoCaB23CMqtkcyH.oyq.IxGcgLF4D6ng.NnG1xC.yMOP.ygorIa" },
];

describe("passwords (bcrypt nativo)", () => {
  it.each(STORED_BY_BCRYPTJS)("aceita a password certa e recusa outra para $hash", async ({ password, hash }) => {
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword(`${password.slice(0, 50)}?`, hash)).toBe(false);
  });

  it("gera hashes $2b$ de custo 10 que verificam", async () => {
    const hash = await hashPassword("Password123!");
    expect(hash).toMatch(/^\$2b\$10\$/);
    expect(await verifyPassword("Password123!", hash)).toBe(true);
    expect(await verifyPassword("password123!", hash)).toBe(false);
  });

  it("um hash inválido ou vazio nunca dá acesso", async () => {
    for (const hash of ["", "lixo", "$2b$10$curto"]) expect(await verifyPassword("Password123!", hash)).toBe(false);
  });
});

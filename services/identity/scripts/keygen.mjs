// Prints a fresh Ed25519 private key as a JWK for `wrangler secret put JWT_PRIVATE_JWK`.
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
process.stdout.write(JSON.stringify(privateKey.export({ format: "jwk" })) + "\n");

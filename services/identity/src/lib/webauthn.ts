import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Env } from "../env";
import { b64urlDecode, b64urlEncode } from "./crypto";

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: string; // base64url COSE
  counter: number;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
}

export interface StoredCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

/**
 * The cryptographic half of WebAuthn, behind an interface so tests can
 * replace it. Option generation stays real everywhere.
 */
export interface WebAuthnVerifier {
  verifyRegistration(env: Env, response: unknown, expectedChallenge: string): Promise<VerifiedRegistration | null>;
  verifyAuthentication(env: Env, response: unknown, expectedChallenge: string, credential: StoredCredential): Promise<{ newCounter: number } | null>;
}

export const simpleWebAuthn: WebAuthnVerifier = {
  async verifyRegistration(env, response, expectedChallenge) {
    try {
      const r = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        requireUserVerification: false,
      });
      if (!r.verified) return null;
      const info = r.registrationInfo;
      return {
        credentialId: info.credential.id,
        publicKey: b64urlEncode(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
      };
    } catch {
      return null;
    }
  },
  async verifyAuthentication(env, response, expectedChallenge, credential) {
    try {
      const r = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        requireUserVerification: false,
        credential: { id: credential.id, publicKey: b64urlDecode(credential.publicKey), counter: credential.counter, transports: credential.transports },
      });
      return r.verified ? { newCounter: r.authenticationInfo.newCounter } : null;
    } catch {
      return null;
    }
  },
};

let verifier: WebAuthnVerifier = simpleWebAuthn;

export function webauthn(): WebAuthnVerifier {
  return verifier;
}

/** Tests install a mock verifier; pass null to restore the real one. */
export function setWebAuthnVerifier(v: WebAuthnVerifier | null): void {
  verifier = v ?? simpleWebAuthn;
}

export async function registrationOptions(env: Env, user: { id: string; email: string; displayName: string }, exclude: { id: string; transports: string[] }[]) {
  return generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME || "Worlds",
    rpID: env.WEBAUTHN_RP_ID,
    userName: user.email,
    userDisplayName: user.displayName || user.email,
    userID: Uint8Array.from(new TextEncoder().encode(user.id)),
    attestationType: "none",
    excludeCredentials: exclude.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
}

export async function authenticationOptions(env: Env) {
  // Discoverable credentials: the authenticator offers the user's passkeys, no email needed.
  return generateAuthenticationOptions({ rpID: env.WEBAUTHN_RP_ID, userVerification: "preferred" });
}

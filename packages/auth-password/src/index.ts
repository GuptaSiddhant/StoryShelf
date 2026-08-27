import type { AuthAdapter, AuthUser } from "@storyshelf/core/adapter/auth";
import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "storyshelf_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: AuthUser["role"];
  expiresAt: number;
}

export interface PasswordAuthOptions {
  password: string;
  secret: string;
}

export interface PasswordAuth extends AuthAdapter {
  login(password: string, user: AuthUser): Promise<string>;
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function equalStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(body: string): SessionPayload | null {
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

function signPayload(secret: string, payload: SessionPayload): string {
  const body = encodePayload(payload);
  return `${body}.${hmacHex(secret, body)}`;
}

function verifyPayload(secret: string, token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!equalStrings(hmacHex(secret, body), signature)) {
    return null;
  }
  return decodePayload(body);
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function toUser(payload: SessionPayload): AuthUser {
  return {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    role: payload.role,
  };
}

export function createPasswordAuth(options: PasswordAuthOptions): PasswordAuth {
  const { password, secret } = options;

  const check = async (request: Request): Promise<AuthUser | null> => {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      return null;
    }
    const payload = verifyPayload(secret, token);
    if (!payload || payload.expiresAt <= Date.now()) {
      return null;
    }
    return toUser(payload);
  };

  const createSession = async (user: AuthUser): Promise<string> => {
    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return signPayload(secret, payload);
  };

  const login = async (input: string, user: AuthUser): Promise<string> => {
    if (!equalStrings(input, password)) {
      throw new Error("Invalid password");
    }
    return await createSession(user);
  };

  return {
    check,
    createSession,
    async destroySession() {
      await Promise.resolve();
    },
    login,
  };
}

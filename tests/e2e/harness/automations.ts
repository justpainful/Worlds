/**
 * E2E Test Harness: Automations Engine & Discord Webhook Integration
 *
 * Implements authoritative automations rules and Discord embed payload contracts
 * from PROJECT.md Features 18, 19 and docs/DISCORD_BRIDGE.md:
 * - SQLite Automations table & trigger types (once, daily, weekly, monthly)
 * - Discord Embed rendering with Worlds gold (#D2A46E -> 0xD2A46E)
 * - HMAC-SHA256 signed webhook delivery
 */

import * as crypto from "node:crypto";

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: "schedule" | "event";
    schedule?: "once" | "daily" | "weekly" | "monthly";
    cron?: string;
    event?: "page_published" | "drawing_exported" | "member_invited";
  };
  actions: Array<{
    type: "discord_webhook" | "backup_create" | "markdown_export";
    params: Record<string, unknown>;
  }>;
  createdAt: number;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number; // Integer representation (e.g. 0xD2A46E)
  fields?: DiscordEmbedField[];
  author?: {
    name: string;
    icon_url?: string;
  };
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string; // ISO 8601
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

export const WORLDS_GOLD_DECIMAL = 0xd2a46e; // #D2A46E

/**
 * Validates a Discord Webhook payload according to Discord API limits:
 * - title <= 256
 * - description <= 4096
 * - fields <= 25
 * - field.name <= 256, field.value <= 1024
 * - footer.text <= 2048
 * - total characters across all embeds <= 6000
 */
export function validateDiscordPayload(payload: DiscordWebhookPayload): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!payload.content && (!payload.embeds || payload.embeds.length === 0)) {
    errors.push("Payload must contain either content or at least one embed");
  }

  if (payload.content && payload.content.length > 2000) {
    errors.push("Content exceeds 2000 characters");
  }

  if (payload.embeds) {
    if (payload.embeds.length > 10) {
      errors.push("Cannot exceed 10 embeds per webhook");
    }

    let totalChars = 0;
    for (const [idx, embed] of payload.embeds.entries()) {
      if (embed.title) {
        if (embed.title.length > 256) {
          errors.push(`Embed [${idx}] title exceeds 256 characters`);
        }
        totalChars += embed.title.length;
      }
      if (embed.description) {
        if (embed.description.length > 4096) {
          errors.push(`Embed [${idx}] description exceeds 4096 characters`);
        }
        totalChars += embed.description.length;
      }
      if (embed.fields) {
        if (embed.fields.length > 25) {
          errors.push(`Embed [${idx}] has more than 25 fields`);
        }
        for (const field of embed.fields) {
          if (!field.name || field.name.length > 256) {
            errors.push(`Embed [${idx}] field name must be 1-256 characters`);
          }
          if (!field.value || field.value.length > 1024) {
            errors.push(`Embed [${idx}] field value must be 1-1024 characters`);
          }
          totalChars += (field.name?.length || 0) + (field.value?.length || 0);
        }
      }
      if (embed.footer?.text) {
        if (embed.footer.text.length > 2048) {
          errors.push(`Embed [${idx}] footer exceeds 2048 characters`);
        }
        totalChars += embed.footer.text.length;
      }
    }

    if (totalChars > 6000) {
      errors.push(`Total embed characters (${totalChars}) exceeds 6000 limit`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Creates and signs an automation webhook message
 */
export function signWebhookPayload(
  payload: Record<string, unknown>,
  secret: string
): {
  body: string;
  signature: string;
} {
  const body = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const signature = `sha256=${hmac.digest("hex")}`;
  return { body, signature };
}

/**
 * Verifies webhook signature against incoming payload
 */
export function verifyWebhookSignature(
  body: string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expectedSig = signatureHeader.slice("sha256=".length);
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const actualSig = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(actualSig), Buffer.from(expectedSig));
}

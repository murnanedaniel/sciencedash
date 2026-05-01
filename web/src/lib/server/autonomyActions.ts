"use server";

import { revalidatePath } from "next/cache";
import {
  setAutonomyConfig,
  KNOWN_ACTION_CLASSES,
  DEFAULT_AUTONOMY,
  type AutonomyConfig,
} from "@/lib/brain/autonomy";
import { prisma } from "@/lib/prisma";

/**
 * Parse the AutonomyEditor form into an AutonomyConfig and persist it.
 *
 * Form shape:
 * - bucket__<actionClassName> = "ask" | "propose" | "auto"   (one per known + custom class)
 * - customActionClass = "name"   (optional new class to add)
 * - customBucket = "ask"|"propose"|"auto"  (target bucket for the new class)
 * - spendCapGpuH = number
 * - spendCapTokensUsd = number
 */
export async function setAutonomyAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  // Read current config so we can preserve any custom classes the user
  // already had defined (the form re-renders them as ActionRows, so
  // they'll have a bucket__ entry too — but defensive code is cheap).
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    select: { autonomyJson: true },
  });
  const prior = parseExisting(existing?.autonomyJson);

  const auto: string[] = [];
  const propose: string[] = [];
  const ask: string[] = [];

  // Walk every bucket__<name> entry in the submitted form.
  const allClassNames = new Set<string>([
    ...KNOWN_ACTION_CLASSES.map((c) => c.name),
    ...prior.auto,
    ...prior.propose,
    ...prior.ask,
  ]);
  for (const name of allClassNames) {
    const bucket = String(formData.get(`bucket__${name}`) ?? "ask");
    if (bucket === "auto") auto.push(name);
    else if (bucket === "propose") propose.push(name);
    else ask.push(name);
  }

  // Optional custom class addition.
  const customName = String(formData.get("customActionClass") ?? "").trim();
  const customBucket = String(formData.get("customBucket") ?? "ask");
  if (customName.length > 0 && /^[a-zA-Z0-9_]+$/.test(customName)) {
    if (!allClassNames.has(customName)) {
      if (customBucket === "auto") auto.push(customName);
      else if (customBucket === "propose") propose.push(customName);
      else ask.push(customName);
    }
  }

  // Spend caps with sane fallback.
  const gpuH = Number(formData.get("spendCapGpuH"));
  const tokensUsd = Number(formData.get("spendCapTokensUsd"));
  const cfg: AutonomyConfig = {
    auto,
    propose,
    ask,
    spendCapGpuH: Number.isFinite(gpuH) && gpuH >= 0 ? gpuH : DEFAULT_AUTONOMY.spendCapGpuH,
    spendCapTokensUsd:
      Number.isFinite(tokensUsd) && tokensUsd >= 0
        ? tokensUsd
        : DEFAULT_AUTONOMY.spendCapTokensUsd,
  };

  await setAutonomyConfig(projectId, cfg);
  revalidatePath(`/projects/${projectId}`);
}

function parseExisting(autonomyJson: string | null | undefined): AutonomyConfig {
  if (!autonomyJson) return DEFAULT_AUTONOMY;
  try {
    const parsed = JSON.parse(autonomyJson) as Partial<AutonomyConfig>;
    return {
      auto: Array.isArray(parsed.auto) ? parsed.auto : [],
      propose: Array.isArray(parsed.propose) ? parsed.propose : [],
      ask: Array.isArray(parsed.ask) ? parsed.ask : [],
      spendCapGpuH:
        typeof parsed.spendCapGpuH === "number"
          ? parsed.spendCapGpuH
          : DEFAULT_AUTONOMY.spendCapGpuH,
      spendCapTokensUsd:
        typeof parsed.spendCapTokensUsd === "number"
          ? parsed.spendCapTokensUsd
          : DEFAULT_AUTONOMY.spendCapTokensUsd,
    };
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { IngredientCategory, IngredientResult } from "@/generated/prisma/client";

export async function upsertIngredient(formData: FormData): Promise<void> {
  const category = String(formData.get("category") ?? "") as IngredientCategory;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) return;
  await prisma.ingredient.upsert({
    where: { category_name: { category, name } },
    create: { category, name, description },
    update: { description },
  });
  revalidatePath("/ingredients");
}

export async function attachIngredient(formData: FormData) {
  const hypothesisId = String(formData.get("hypothesisId") ?? "");
  const ingredientId = String(formData.get("ingredientId") ?? "");
  const variant = String(formData.get("variant") ?? "").trim() || null;
  const result = (String(formData.get("result") ?? "pending") as IngredientResult);
  if (!hypothesisId || !ingredientId) return;
  await prisma.hypothesisIngredient.upsert({
    where: { hypothesisId_ingredientId: { hypothesisId, ingredientId } },
    create: { hypothesisId, ingredientId, variant, result },
    update: { variant, result },
  });
  revalidatePath("/ingredients");
  const h = await prisma.hypothesis.findUnique({
    where: { id: hypothesisId },
    select: { projectId: true },
  });
  if (h) revalidatePath(`/projects/${h.projectId}`);
}

export async function detachIngredient(formData: FormData) {
  const hypothesisId = String(formData.get("hypothesisId") ?? "");
  const ingredientId = String(formData.get("ingredientId") ?? "");
  if (!hypothesisId || !ingredientId) return;
  await prisma.hypothesisIngredient.delete({
    where: { hypothesisId_ingredientId: { hypothesisId, ingredientId } },
  });
  revalidatePath("/ingredients");
}

import { z } from "zod";
import { CLASS_IDS, GENDER_IDS, RACE_IDS } from "./content.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Логин должен содержать минимум 3 символа")
  .max(24, "Логин не должен быть длиннее 24 символов")
  .regex(/^[\p{L}\p{N}_-]+$/u, "Допустимы буквы, цифры, _ и -");

export const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(128, "Пароль слишком длинный");

export const characterNameSchema = z
  .string()
  .trim()
  .min(2, "Имя должно содержать минимум 2 символа")
  .max(20, "Имя не должно быть длиннее 20 символов")
  .regex(/^[\p{L}][\p{L}' -]*$/u, "Используйте буквы, пробел, дефис или апостроф");

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = registerSchema;

export const createCharacterSchema = z.object({
  name: characterNameSchema,
  race: z.enum(RACE_IDS),
  gender: z.enum(GENDER_IDS),
  classId: z.enum(CLASS_IDS),
});

const finiteNumber = z.number().finite();

export const movementInputSchema = z.object({
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  direction: z.object({
    x: finiteNumber.min(-1).max(1),
    z: finiteNumber.min(-1).max(1),
  }),
  facing: finiteNumber.min(-Math.PI * 4).max(Math.PI * 4),
  sprint: z.boolean(),
});

export const targetInputSchema = z.object({
  targetId: z.string().uuid().nullable(),
});

export const abilityInputSchema = z.object({
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  abilityId: z.enum(["basic", "vanguard_strike", "aether_bolt"]),
  targetId: z.string().uuid().nullable(),
});

export const pickupInputSchema = z.object({
  lootId: z.string().uuid(),
});

export const chatInputSchema = z.object({
  text: z.string().trim().min(1).max(240),
});

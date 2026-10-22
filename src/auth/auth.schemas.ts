import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

const newPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email,
  password: newPassword,
});
export type RegisterInput = z.output<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.output<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPassword,
});
export type ResetPasswordInput = z.output<typeof resetPasswordSchema>;

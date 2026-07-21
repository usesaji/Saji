import { z } from "zod";

// Same strong password regex from your Yup schema
export const isStrongPassword = (password: string) => {
  return /^(?=.*[A-Za-z])(?=.*[\d!@#$%^&*(),.?":{}|<>;'[\]~\-_=+])[A-Za-z\d!@#$%^&*(),.?":{}|<>;'[\]~\-_=+]{8,}$/.test(
    password
  );
};

export const SignUpSchema = z
  .object({
    email: z
      .string()
      .nonempty("Email is required")
      .email("Invalid email address"),

  //   password: z
  //     .string()
  //     .min(6, "Password must be at least 6 characters")
  //     .refine(
  //       (v) => /[A-Z]/.test(v),
  //       "Must contain at least 1 uppercase letter"
  //     )
  //     .refine(
  //       (v) => /[a-z]/.test(v),
  //       "Must contain at least 1 lowercase letter"
  //     )
  //     .refine((v) => /\d/.test(v), "Must contain at least 1 number")
  //     .refine(
  //       (v) => /[@$!%*?&.,_\-+=#]/.test(v),
  //       "Must contain at least 1 symbol"
  //     ),

  //   confirmPassword: z.string().nonempty("Please confirm your password"),
  // })
  // .refine((data) => data.password === data.confirmPassword, {
  //   message: "Passwords do not match",
  //   path: ["confirmPassword"],
  // })

  // // ❌ Password must NOT contain email
  // .refine((data) => !data.password.includes(data.email), {
  //   message: "Can't contain your email address",
  //   path: ["password"], // attach error to password
  // })

  // // ❌ Passwords must match
  // .refine((data) => data.password === data.confirmPassword, {
  //   message: "Passwords do not match",
  //   path: ["confirmPassword"],
  });

export const SignInSchema = z.object({
  email: z
    .string()
    .nonempty("Email is required")
    .email("Invalid email address"),
  password: z.string().nonempty("Password is required"),
});

export const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .nonempty("Email is required")
    .email("Invalid email address"),
});

export const ResetPasswordSchema = z
  .object({
    otp: z.string().nonempty("OTP is required").min(6, "OTP must be 6 digits"),
    password: z
      .string()
      .nonempty("Password is required")
      .min(8, "At least 8 characters")
      .refine(
        (value) => /[\d@$!%*?&]/.test(value), // number or symbol
        "Contain a number or symbol"
      )
      .refine((value) => isStrongPassword(value), "Password strength: Weak"),

    confirmPassword: z.string().nonempty("Please confirm your password"),
  })

  // ❌ Passwords must match
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const SetUpAccountSchema = z.object({
  first_name: z
    .string()
    .nonempty("First name is required")
    .trim()
    .min(2, "First name is too short")
    .max(50, "First name is too long"),

  last_name: z
    .string()
    .nonempty("Last name is required")
    .trim()
    .min(2, "Last name is too short")
    .max(50, "Last name is too long"),

  business_name: z
    .string()
    .trim()
    .min(2, "Business name is too short")
    .max(100, "Business name is too long")
    .optional()
    .or(z.literal("")),

  phone_number: z
    .string()
    .trim()
    .regex(
      /^\+?\d+$/,
      "Phone number must be digits only (optionally starts with +)"
    )
    .min(7, "Phone number too short")
    .max(15, "Phone number too long")
    .optional()
    .or(z.literal("")),

  country: z.string().trim().min(1, "Country is required"),
});

export type SetUpAccountValues = z.infer<typeof SetUpAccountSchema>;

export const UpdateUserSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .nonempty("Email is required"),

  first_name: z
    .string()
    .min(2, "First name must be at least 2 characters")
    .max(50, "First name is too long"),

  last_name: z
    .string()
    .min(2, "Last name must be at least 2 characters")
    .max(50, "Last name is too long"),

  business_name: z
    .string()
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name is too long").optional(),

  phone_number: z
    .string()
    .nonempty("Phone number is required")
    .regex(/^\+?\d{7,15}$/, "Invalid phone number").optional(),

  country: z.string().min(2, "Country is required"),

  currency: z.string().min(2, "Currency is required"),

  wallet_address: z
    .string()
    // .nonempty("Wallet address is required")
    // .regex(/^(0x)?[0-9a-fA-F]{40}$/, "Invalid wallet address"),
});

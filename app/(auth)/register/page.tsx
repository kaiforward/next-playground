"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerSchema, type RegisterInput } from "@/lib/schemas/auth";
import { TextInput } from "@/components/ui/text-input";
import { FormError } from "@/components/ui/form-error";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  async function onSubmit(data: RegisterInput) {
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || "Registration failed");
        setLoading(false);
        return;
      }

      // Auto sign-in after successful registration
      const signInResult = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (signInResult?.error) {
        // Registration succeeded but auto-login failed, redirect to login
        router.push("/login");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-wider">Stellar Trader</h1>
          <p className="text-white/60 mt-2">Create your account</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="border border-white/10 rounded-lg p-6 bg-white/5 backdrop-blur-sm space-y-4"
        >
          <FormError message={error} />

          <TextInput
            id="name"
            type="text"
            label="Commander Name"
            autoComplete="name"
            placeholder="Commander Shepard"
            error={errors.name?.message}
            {...register("name")}
          />

          <TextInput
            id="email"
            type="email"
            label="Email"
            autoComplete="email"
            placeholder="commander@example.com"
            error={errors.email?.message}
            {...register("email")}
          />

          <TextInput
            id="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            error={errors.password?.message}
            {...register("password")}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>

          <p className="text-center text-sm text-white/50 pt-2">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

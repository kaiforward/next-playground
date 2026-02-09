"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { TextInput } from "@/components/ui/text-input";
import { FormError } from "@/components/ui/form-error";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(data: LoginInput) {
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
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
          <p className="text-white/60 mt-2">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="border border-white/10 rounded-lg p-6 bg-white/5 backdrop-blur-sm space-y-4"
        >
          <FormError message={error} />

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
            autoComplete="current-password"
            placeholder="Enter your password"
            error={errors.password?.message}
            {...register("password")}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <p className="text-center text-sm text-white/50 pt-2">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

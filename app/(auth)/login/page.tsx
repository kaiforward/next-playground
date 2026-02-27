"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { TextInput } from "@/components/form/text-input";
import { FormError } from "@/components/form/form-error";
import { Button } from "@/components/ui/button";

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
        router.push("/");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-wider">Stellar Trader</h1>
        <p className="text-text-secondary mt-2">Sign in to your account</p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="border border-border rounded-lg p-6 bg-surface backdrop-blur-sm space-y-4"
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

        <Button type="submit" disabled={loading} fullWidth>
          {loading ? "Signing in..." : "Sign In"}
        </Button>

        <p className="text-center text-sm text-text-tertiary pt-2">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            Create one
          </Link>
        </p>
      </form>
    </>
  );
}

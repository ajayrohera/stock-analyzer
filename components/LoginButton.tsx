'use client';
import { signIn } from "next-auth/react";

export default function LoginButton() {
  const handleLogin = async () => {
    try {
      await signIn("google", { 
        callbackUrl: "/"
      });
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <button 
      onClick={handleLogin} 
      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg"
    >
      Sign in with Google
    </button>
  );
}
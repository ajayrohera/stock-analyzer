'use client';
import { useSession } from "next-auth/react";

export default function UserProfile() {
  const { data: session } = useSession();
  
  // Add null checks
  if (!session?.user) {
    return null; // Or a loading state
  }

  return (
    <div className="flex items-center gap-3">
      <img 
        src={session.user.image || "/default-avatar.png"} 
        className="w-8 h-8 rounded-full" 
        alt="Profile"
      />
      <span>Hello, {session.user.name || 'User'}</span>
    </div>
  );
}
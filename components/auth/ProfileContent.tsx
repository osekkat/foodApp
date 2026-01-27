"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ProfileHeader,
  ProfileReviews,
  ProfileLists,
  ProfileSettings,
} from "@/components/profile";
import { LogOut, MessageSquare, List, Settings } from "lucide-react";

export default function ProfileContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center py-12">
            <div className="size-8 animate-spin rounded-full border-4 border-orange-600 border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white dark:bg-black">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">Profile</h1>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            Please sign in to view your profile.
          </p>
          <Link
            href="/signin"
            className="mt-4 inline-block rounded-lg bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 sm:text-3xl">
            My Profile
          </h1>
          <Button
            variant="ghost"
            onClick={handleSignOut}
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <LogOut className="mr-2 size-4" />
            Sign Out
          </Button>
        </div>

        <div className="mt-8">
          <ProfileHeader />
        </div>

        <Tabs defaultValue="reviews" className="mt-10">
          <TabsList variant="line" className="w-full justify-start border-b border-zinc-200 dark:border-zinc-800">
            <TabsTrigger value="reviews" className="gap-2">
              <MessageSquare className="size-4" />
              Reviews
            </TabsTrigger>
            <TabsTrigger value="lists" className="gap-2">
              <List className="size-4" />
              Lists
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="size-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reviews" className="mt-6">
            <ProfileReviews />
          </TabsContent>

          <TabsContent value="lists" className="mt-6">
            <ProfileLists />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <ProfileSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";

import { identifyLogRocketUser, startLogRocket } from "@/lib/logrocket";

type LogRocketProviderProps = {
  children: React.ReactNode;
};

export function LogRocketProvider({ children }: LogRocketProviderProps) {
  const userResult = useUser();
  const userIsLoaded = userResult.isLoaded;
  const userId = userResult.user?.id;

  useEffect(() => {
    startLogRocket();
  }, []);

  useEffect(() => {
    if (!userIsLoaded) {
      return;
    }

    if (userId === undefined) {
      return;
    }

    identifyLogRocketUser({
      userId,
    });
  }, [userId, userIsLoaded]);

  return children;
}

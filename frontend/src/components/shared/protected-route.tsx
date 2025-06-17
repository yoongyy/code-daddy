import React from "react";
import { Navigate } from "react-router";
import { useSimpleAuth } from "#/context/simple-auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoggedIn, checkAuthStatus } = useSimpleAuth();

  // Double-check auth status on each render
  const isAuthenticated = isLoggedIn || checkAuthStatus();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

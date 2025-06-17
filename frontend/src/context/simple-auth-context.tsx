import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from "react";

interface SimpleAuthContextType {
  isLoggedIn: boolean;
  login: () => void;
  logout: () => void;
  checkAuthStatus: () => boolean;
}

const SimpleAuthContext = createContext<SimpleAuthContextType | undefined>(
  undefined,
);

export function SimpleAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const checkAuthStatus = () => {
    if (typeof window === "undefined") return false;

    const loginState = localStorage.getItem("isLoggedIn");
    const loginTimestamp = localStorage.getItem("loginTimestamp");

    if (loginState === "true" && loginTimestamp) {
      // Optional: Add session timeout (e.g., 24 hours)
      const now = Date.now();
      const loginTime = parseInt(loginTimestamp, 10);
      const sessionDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      if (now - loginTime < sessionDuration) {
        return true;
      }
      // Session expired, clear storage
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("loginTimestamp");
      return false;
    }

    return false;
  };

  const login = () => {
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("loginTimestamp", Date.now().toString());
    setIsLoggedIn(true);
  };

  const logout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("loginTimestamp");
    setIsLoggedIn(false);
  };

  useEffect(() => {
    setIsLoggedIn(checkAuthStatus());
  }, []);

  const value = useMemo(
    () => ({
      isLoggedIn,
      login,
      logout,
      checkAuthStatus,
    }),
    [isLoggedIn, login, logout, checkAuthStatus],
  );

  return (
    <SimpleAuthContext.Provider value={value}>
      {children}
    </SimpleAuthContext.Provider>
  );
}

export function useSimpleAuth() {
  const context = useContext(SimpleAuthContext);
  if (context === undefined) {
    throw new Error("useSimpleAuth must be used within a SimpleAuthProvider");
  }
  return context;
}

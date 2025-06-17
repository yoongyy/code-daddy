import React, { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useSimpleAuth } from "#/context/simple-auth-context";
import { I18nKey } from "#/i18n/declaration";

const HARDCODED_USERNAME = "root";
const HARDCODED_PASSWORD = "123456";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { login } = useSimpleAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Simulate a small delay for better UX
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 500);
    });

    if (username === HARDCODED_USERNAME && password === HARDCODED_PASSWORD) {
      // Use the simple auth context to login
      login();

      // Navigate to home page
      navigate("/");
    } else {
      setError(t(I18nKey.AUTH$INVALID_CREDENTIALS));
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">OpenHands</h1>
          <h2 className="text-xl text-gray-300">
            {t(I18nKey.AUTH$SIGN_IN_TO_ACCOUNT)}
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter username"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter password"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800 rounded-md p-3">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t(I18nKey.AUTH$SIGNING_IN) : t(I18nKey.AUTH$SIGN_IN)}
            </button>
          </div>

          {/* <div className="text-center text-sm text-gray-400">
            <p>{t(I18nKey.AUTH$DEMO_CREDENTIALS)}</p>
            <p>
              Username: <span className="text-gray-300 font-mono">root</span>
            </p>
            <p>
              Password: <span className="text-gray-300 font-mono">123456</span>
            </p>
          </div> */}
        </form>
      </div>
    </div>
  );
}

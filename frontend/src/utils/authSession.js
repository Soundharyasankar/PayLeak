export function authErrorMessage(error, fallback) {
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  const message = error?.response?.data?.error?.message;

  if (status === 401) {
    if (code === "INVALID_CREDENTIALS") return message || "Email or password is incorrect.";
    if (code === "AUTH_REQUIRED") return "PayLeak could not establish a browser session. Check your browser's privacy settings and try again.";
    if (code === "INVALID_TOKEN") return "PayLeak rejected the session token. Please try again; contact support if this continues.";
    return message || "PayLeak could not verify your session. Please sign in again.";
  }
  if (status === 403) return message || "You are signed in, but you do not have permission to access this resource.";
  if (!error?.response && error?.isAxiosError) return "PayLeak could not be reached. Check your connection and try again.";
  return message || error?.message || fallback;
}

export async function verifySessionUser(expectedUser, loadCurrentUser) {
  let sessionUser;
  try {
    sessionUser = await loadCurrentUser();
  } catch (error) {
    if (error?.response?.status === 401) {
      throw new Error(authErrorMessage(error, "PayLeak could not verify your session. Please sign in again."));
    }
    throw error;
  }

  if (!expectedUser?.id || sessionUser?.id !== expectedUser.id) {
    throw new Error("The server session does not match the account that signed in. Please sign in again.");
  }
  return sessionUser;
}

export function shouldClearAuthSession(error) {
  if (error?.response?.status !== 401) return false;

  const url = error.config?.url?.split("?")[0]?.replace(/\/+$/, "");
  const method = error.config?.method?.toLowerCase();
  return !(
    (method === "post" && (url === "/auth/login" || url === "/auth/register"))
    || (method === "get" && url === "/auth/me")
  );
}

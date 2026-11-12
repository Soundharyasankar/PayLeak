export async function verifySessionUser(expectedUser, loadCurrentUser) {
  let sessionUser;
  try {
    sessionUser = await loadCurrentUser();
  } catch (error) {
    if (error?.response?.status === 401) {
      throw new Error("The server could not confirm your sign-in. Please try again and check that secure cookies are enabled.");
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

export function claimPaypalWelcome(user, connected, storageOverride) {
  const userId = user?.id || user?._id;
  if (!connected || !userId) return false;

  try {
    const storage = storageOverride || globalThis.localStorage;
    if (!storage) return false;
    const key = `payleak:paypal-welcome:${userId}`;
    if (storage.getItem(key)) return false;
    storage.setItem(key, "shown");
    return true;
  } catch (error) {
    console.error("Could not save the PayPal welcome notification state.", error);
    return false;
  }
}

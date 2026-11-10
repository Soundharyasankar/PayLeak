import { api, endpoints, responseData } from "./api.js";

export async function fetchNotifications() {
  return responseData(await api.get(endpoints.notifications));
}

export async function setNotificationRead(id, read) {
  return responseData(await api.patch(`${endpoints.notifications}/${encodeURIComponent(id)}`, { read }));
}

export async function markAllNotificationsRead() {
  return responseData(await api.patch(`${endpoints.notifications}/read-all`));
}

export async function draftReminder(invoiceId) {
  return responseData(await api.post(`${endpoints.notifications}/reminders/${encodeURIComponent(invoiceId)}/draft`));
}

export async function sendReminder(invoiceId) {
  return responseData(await api.post(`${endpoints.notifications}/reminders/${encodeURIComponent(invoiceId)}/send`));
}

export async function deleteNotification(id) {
  await api.delete(`${endpoints.notifications}/${encodeURIComponent(id)}`);
}

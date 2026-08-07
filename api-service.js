/**
 * taskService.js — thin client wrapper around the Apps Script Web App
 * (see Code.gs). Deploy Code.gs first, then paste the /exec URL below.
 */

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzN33vomd4IsSBYMTdo5QAnyu4KZHLu2k5_vlA-vF6uiABvKE7aX_18dL83fgzcnHzR/exec';

/** GET all tasks -> Task[] */
export async function fetchTasks() {
  const res = await fetch(`${SCRIPT_URL}?action=list`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * POST a new task. Task_ID and Assigned_Date are generated server-side.
 * taskData: { Task_Name, Description, Owner_Name, Assigned_To, Deadline,
 *             Start_Date, Effort_Estimation_Days, Traffic_Light_Color,
 *             Status, Priority_Rank, WIP_Override_Reason }
 */
export async function createTask(taskData) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight against Apps Script
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'create', data: taskData })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** PATCH-style update. updatedFields: partial object keyed by column name. */
export async function updateTask(taskId, updatedFields) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'update', taskId, fields: updatedFields })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function deleteTask(taskId) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'delete', taskId })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** Working days (Mon-Fri) strictly between two dates — mirrors server logic for client-side previews. */
export function getWorkingDaysBetween(startDate, endDate) {
  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** Add N working days to a date — useful to preview Estimated_completion_Date client-side. */
export function addWorkingDays(startDate, numDays) {
  const cur = new Date(startDate);
  let added = 0;
  while (added < numDays) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return cur;
}

/**
 * Kanban Drag & Drop State Logic
 * -------------------------------
 * Uses SortableJS (CDN): <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>
 *
 * DOM CONTRACT (adapt selectors to your markup):
 *   <div class="task-list" data-assignee="Alice"> ... task cards ... </div>
 *   <div class="task-card" data-task-id="t1">
 *     <select class="status-select" data-task-id="t1">
 *       <option>Not Picked</option><option>Next Up</option><option>WIP</option><option>Done</option>
 *     </select>
 *   </div>
 *
 * Every column is a `.task-list` with data-assignee = the assignee name.
 * Task DOM order == Priority_Rank order (index 0 = highest priority).
 */

// ---------------------------------------------------------------------------
// 1. STATE (single source of truth — Sortable only reflects this, never leads it)
// ---------------------------------------------------------------------------
let tasks = [
  // { id, title, Assigned_To, Priority_Rank, status, Effort_Estimation_Days }
];

// ---------------------------------------------------------------------------
// 2. RENDER — rebuilds every column's DOM from `tasks`. Call after any state change.
//    Re-rendering after every drag (even cancelled ones) is what lets us "revert"
//    a Sortable-initiated DOM move without fighting the library.
// ---------------------------------------------------------------------------
function render() {
  document.querySelectorAll('.task-list').forEach((column) => {
    const assignee = column.dataset.assignee;
    const columnTasks = tasks
      .filter((t) => t.Assigned_To === assignee)
      .sort((a, b) => a.Priority_Rank - b.Priority_Rank);

    column.innerHTML = columnTasks.map(taskCardHTML).join('');
  });

  // Re-bind status <select> listeners since innerHTML was replaced
  document.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', onStatusChange);
  });
}

function taskCardHTML(task) {
  return `
    <div class="task-card" data-task-id="${task.id}">
      <div class="task-title">${task.title}</div>
      <div class="task-meta">${task.status}${
        task.Effort_Estimation_Days ? ` · ${task.Effort_Estimation_Days}d` : ''
      }</div>
      <select class="status-select" data-task-id="${task.id}">
        ${['Not Picked', 'Next Up', 'WIP', 'Done']
          .map(
            (s) =>
              `<option value="${s}" ${s === task.status ? 'selected' : ''}>${s}</option>`
          )
          .join('')}
      </select>
    </div>`;
}

// ---------------------------------------------------------------------------
// 3. INIT SORTABLE — one instance per assignee column, all sharing a group
//    so cards can be dragged between columns (horizontal reassignment).
// ---------------------------------------------------------------------------
function initKanbanDragDrop() {
  document.querySelectorAll('.task-list').forEach((column) => {
    new Sortable(column, {
      group: 'kanban-assignees', // shared group name enables cross-column drags
      animation: 150,
      onEnd: handleDragEnd,
    });
  });

  render(); // initial paint
}

// ---------------------------------------------------------------------------
// 4. DRAG END HANDLER — routes to vertical reorder vs horizontal reassignment
// ---------------------------------------------------------------------------
function handleDragEnd(evt) {
  const taskId = evt.item.dataset.taskId;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const fromAssignee = evt.from.dataset.assignee;
  const toAssignee = evt.to.dataset.assignee;

  if (fromAssignee === toAssignee) {
    handleVerticalReorder(task, evt.oldIndex, evt.newIndex, fromAssignee);
  } else {
    handleHorizontalReassignment(task, toAssignee);
  }
}

// ---------------------------------------------------------------------------
// 5. VERTICAL REORDER — with WIP override guard
// ---------------------------------------------------------------------------
function handleVerticalReorder(task, oldIndex, newIndex, assignee) {
  const isDeprioritizing = newIndex > oldIndex; // moving further down the list

  if (task.status === 'WIP' && isDeprioritizing) {
    // Intercept: don't commit yet. Re-render first to snap the DOM back to
    // the current (unchanged) state array, undoing Sortable's optimistic move.
    render();
    showWipOverrideModal(task, (reason) => {
      // Confirmed — apply the reorder the user originally attempted
      applyReorder(assignee, oldIndex, newIndex, task.id);
      render();

      // Sync the override reason + new rank to Google Sheets (fire-and-forget;
      // UI has already moved on, so we just log if the write fails)
      updateTask(task.id, {
        WIP_Override_Reason: reason,
        Priority_Rank: task.Priority_Rank,
      }).catch((err) =>
        console.error(`Failed to sync WIP override for "${task.title}":`, err)
      );
    });
    // On cancel, showWipOverrideModal does nothing further — DOM already reverted.
    return;
  }

  // Normal reorder, no confirmation needed
  applyReorder(assignee, oldIndex, newIndex, task.id);
  render();

  // Sync the new rank to Google Sheets quietly, in the background
  updateTask(task.id, { Priority_Rank: task.Priority_Rank }).catch((err) =>
    console.error(`Failed to sync reorder for "${task.title}":`, err)
  );
}

// Recomputes Priority_Rank for a column after moving `taskId` from oldIndex to newIndex
function applyReorder(assignee, oldIndex, newIndex, taskId) {
  const columnTasks = tasks
    .filter((t) => t.Assigned_To === assignee)
    .sort((a, b) => a.Priority_Rank - b.Priority_Rank);

  const [moved] = columnTasks.splice(oldIndex, 1);
  columnTasks.splice(newIndex, 0, moved);

  columnTasks.forEach((t, i) => {
    t.Priority_Rank = i;
  });
}

// ---------------------------------------------------------------------------
// 6. HORIZONTAL REASSIGNMENT — change Assigned_To, append to bottom of target column
// ---------------------------------------------------------------------------
function handleHorizontalReassignment(task, newAssignee) {
  task.Assigned_To = newAssignee;

  const targetColumnTasks = tasks.filter(
    (t) => t.Assigned_To === newAssignee && t.id !== task.id
  );
  const maxRank = targetColumnTasks.reduce(
    (max, t) => Math.max(max, t.Priority_Rank),
    -1
  );
  task.Priority_Rank = maxRank + 1;

  render();

  // Sync the reassignment + new rank to Google Sheets quietly
  updateTask(task.id, {
    Assigned_To: task.Assigned_To,
    Priority_Rank: task.Priority_Rank,
  }).catch((err) =>
    console.error(`Failed to sync reassignment for "${task.title}":`, err)
  );
}

// ---------------------------------------------------------------------------
// 7. STATUS TRANSITION LOGIC — hooked to each card's <select class="status-select">
// ---------------------------------------------------------------------------
function onStatusChange(evt) {
  const taskId = evt.target.dataset.taskId;
  const newStatus = evt.target.value;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const isActivating =
    task.status === 'Not Picked' && ['Next Up', 'WIP'].includes(newStatus);

  if (isActivating) {
    showEffortEstimationModal(task, (days) => {
      task.status = newStatus;
      task.Effort_Estimation_Days = days;
      render();
    });
    // Revert the <select> visually until the estimate is submitted
    evt.target.value = task.status;
    return;
  }

  task.status = newStatus;
  render();
}

// ---------------------------------------------------------------------------
// 8. MODALS — minimal, dependency-free. Style `.modal-overlay` / `.modal` in your CSS.
// ---------------------------------------------------------------------------
function showWipOverrideModal(task, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>⚠ WIP Task Deprioritization</h3>
      <p>This task is currently being worked on. Deprioritizing it will halt progress.</p>
      <label for="override-reason">Reason for Override</label>
      <input type="text" id="override-reason" placeholder="Required" />
      <div class="modal-actions">
        <button id="cancel-move">Cancel</button>
        <button id="confirm-move" disabled>Confirm Move</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const reasonInput = overlay.querySelector('#override-reason');
  const confirmBtn = overlay.querySelector('#confirm-move');
  const cancelBtn = overlay.querySelector('#cancel-move');

  // Reason is required before "Confirm Move" is enabled
  reasonInput.addEventListener('input', () => {
    confirmBtn.disabled = reasonInput.value.trim().length === 0;
  });

  confirmBtn.addEventListener('click', () => {
    const reason = reasonInput.value.trim();
    document.body.removeChild(overlay);
    onConfirm(reason);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    // No callback — reorder is simply abandoned, DOM already reverted by render()
  });
}

function showEffortEstimationModal(task, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Effort Estimation Required</h3>
      <p>Enter an effort estimate before activating "${task.title}".</p>
      <label for="effort-days">Effort Estimation (in Days)</label>
      <input type="number" id="effort-days" min="0.5" step="0.5" placeholder="Required" />
      <div class="modal-actions">
        <button id="cancel-status">Cancel</button>
        <button id="confirm-status" disabled>Submit</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const daysInput = overlay.querySelector('#effort-days');
  const confirmBtn = overlay.querySelector('#confirm-status');
  const cancelBtn = overlay.querySelector('#cancel-status');

  daysInput.addEventListener('input', () => {
    confirmBtn.disabled = !(parseFloat(daysInput.value) > 0);
  });

  confirmBtn.addEventListener('click', () => {
    const days = parseFloat(daysInput.value);
    document.body.removeChild(overlay);
    onSubmit(days);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    render(); // ensure select snaps back to previous status
  });
}


// ---------------------------------------------------------------------------
// 8.1 TASK CREATION — wired to the Create Task modal's Save button (part A)
//     NOTE: 'save-task-btn' / 'input-name' / 'input-assignee' are placeholders —
//     this file has no Create Task modal markup, so swap in your real element
//     IDs. closeModal() is assumed to exist in your modal-open/close code.
// ---------------------------------------------------------------------------
function initTaskCreation() {
  const saveBtn = document.getElementById('save-task-btn');
  if (!saveBtn) return; // modal not on this page — nothing to wire up

  saveBtn.addEventListener('click', async () => {
    const newTaskData = {
      Task_Name: document.getElementById('input-name').value,
      Assigned_To: document.getElementById('input-assignee').value,
      // ... gather other inputs ...
    };

    saveBtn.disabled = true; // guard against double-submit while awaiting
    try {
      // 1. Send to Google Sheets (api-service.js)
      const savedTask = await createTask(newTaskData);

      // 2. Fold it into local state and re-render through the existing
      //    render() pipeline (this file has no renderTaskTile — every
      //    column is rebuilt from `tasks`, so pushing + render() is correct)
      tasks.push({
        id: savedTask.id,
        title: savedTask.Task_Name,
        Assigned_To: savedTask.Assigned_To,
        Priority_Rank: savedTask.Priority_Rank ?? tasks.length,
        status: savedTask.status ?? 'Not Picked',
        Effort_Estimation_Days: savedTask.Effort_Estimation_Days,
      });
      render();

      // 3. Close the modal
      closeModal();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// 9. BOOTSTRAP — single entry point, so Sortable and the Save button are
//    each wired up exactly once, and real data replaces the empty `tasks`
//    array as soon as it arrives.
// ---------------------------------------------------------------------------
async function initializeApp() {
  // 1. Wire up drag-and-drop + task-creation listeners (DOM must already exist)
  initKanbanDragDrop(); // also does the initial (empty) paint
  initTaskCreation();

  try {
    // 2. Authenticate and fetch real tasks from api-service.js
    const realTasks = await fetchTasks();

    // 3. Feed them into state — setTasks() re-renders every column for us
    window.setTasks(realTasks);
  } catch (error) {
    console.error('Failed to load tasks:', error);
  }
}

// DOMContentLoaded (not window.onload) so we wire up interactions as soon as
// the DOM is ready, without waiting on images/stylesheets to finish loading.
document.addEventListener('DOMContentLoaded', initializeApp);

// Exposed for external state seeding, e.g.:
//   window.setTasks(fetchedTasksFromAPI);
window.setTasks = (newTasks) => {
  tasks = newTasks;
  render();
};
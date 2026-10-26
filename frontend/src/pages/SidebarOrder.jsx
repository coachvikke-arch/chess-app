import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useToast } from '../components/Toast';
import { useSidebarOrder } from '../context/SidebarOrderContext';
import { moveItem, moveToKey, orderKeys } from '../utils/navOrder';
import { adminLinks, studentLinks } from '../config/sidebarConfigs';
import Button from '../components/Button';

/* Every list the Super Admin can order, taken from the very arrays the screens
   render. Duplicating a list here would let the panel and the screen drift,
   which is exactly the bug this feature is meant to prevent. The owner-only
   rows (Certificates, Certificate Settings and the console sections) live inline
   in the coach list with `superOnly`, so they are ordered on that tab like
   everything else. */
const MENUS = [
  { key: 'admin', label: 'Coach menu', links: adminLinks, who: 'every coach and Super Admin' },
  { key: 'student', label: 'Student menu', links: studentLinks, who: 'every student' },
];

const DRAG_HINT = '⠿';

/* One row. The drag handle is its own focusable button rather than the whole row,
   so that dragging never fights with selecting the text or clicking the arrows,
   and so a screen reader announces a proper "sortable" control instead of a
   generic container. */
function SortableRow({ link, index, total, isDropTarget, onMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.to,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'perm-row',
        'navorder-row',
        isDragging ? 'navorder-row--dragging' : '',
        isDropTarget ? 'navorder-row--over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="navorder-handle"
        aria-label={`Reorder ${link.label}. Position ${index + 1} of ${total}.`}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">{DRAG_HINT}</span>
      </button>

      <span className="navorder-label">
        <span className="navorder-icon" aria-hidden="true">{link.icon}</span>
        {link.label}
        {link.superLabel && (
          <span className="navorder-alt">Super Admin sees “{link.superLabel}”</span>
        )}
      </span>

      <span className="navorder-controls">
        <button
          type="button"
          className="navorder-arrow"
          onClick={() => onMove(index, -1)}
          disabled={index === 0}
          aria-label={`Move ${link.label} up`}
        >
          ▲
        </button>
        <button
          type="button"
          className="navorder-arrow"
          onClick={() => onMove(index, 1)}
          disabled={index === total - 1}
          aria-label={`Move ${link.label} down`}
        >
          ▼
        </button>
      </span>
    </div>
  );
}

export default function SidebarOrder() {
  const { showToast } = useToast();
  const { ranks, orderFor, saveOrder, resetOrder } = useSidebarOrder();

  const [menu, setMenu] = useState('admin');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  /* A small activation distance keeps a plain click on the handle from starting a
     drag, and a short delay lets a touch scroll still win over a drag. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6, delay: 140, tolerance: 8 } }),
    /* Space/Enter lifts a row, arrows move it, space/Enter drops it, Escape
       cancels — so the panel stays usable without a pointer. */
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const source = useMemo(() => MENUS.find((m) => m.key === menu) ?? MENUS[0], [menu]);
  /* The SAVED order, as the link objects the row renders. orderFor() returns the
     nav items themselves — reducing it to bare route strings here would leave
     every row without an icon or a label, and would post `undefined` keys. */
  const saved = useMemo(() => orderFor(source.key, source.links), [orderFor, source]);
  const items = draft ?? saved;
  /* Compared as route keys, since that is what actually gets stored. */
  const dirty = draft !== null && orderKeys(items).join(' ') !== orderKeys(saved).join(' ');

  /* Switching menu abandons an unsaved draft rather than carrying one menu's
     sequence into another. */
  const selectMenu = useCallback((key) => {
    setDraft(null);
    setMenu(key);
  }, []);

  useEffect(() => { setDraft(null); }, [menu]);

  function move(index, direction) {
    setDraft(moveItem(items, index, direction));
  }

  /* The order is committed on drop rather than on every pointer move, so the
     list cannot end up in a different sequence than the one that was released. */
  function onDragStart({ active }) {
    setDragging(active.id);
  }

  function onDragOver({ over }) {
    setDropTarget(over ? over.id : null);
  }

  function onDragEnd({ active, over }) {
    setDragging(null);
    setDropTarget(null);
    if (!over) return;
    setDraft(moveToKey(items, active.id, over.id));
  }

  function onDragCancel() {
    setDragging(null);
    setDropTarget(null);
  }

  async function save() {
    setSaving(true);
    try {
      await saveOrder(source.key, orderKeys(items));
      setDraft(null);
      showToast(`Saved. This menu is now in this order for ${source.who}.`);
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not save the order', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await resetOrder(source.key);
      setDraft(null);
      showToast('Reset to the default order.');
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not reset the order', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const isCustomised = Object.keys(ranks[source.key] ?? {}).length > 0;
  const draggingLink = dragging ? items.find((l) => l.to === dragging) : null;

  return (
    <div className="space-y-4">
      <div className="chess-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="chess-card-title mb-0">
            <span className="chess-card-piece">↕</span>
            <span className="flex-1">Sidebar order</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary" size="md" className="!px-4 !py-2 text-sm"
              onClick={reset}
              disabled={saving || !isCustomised}
              title={isCustomised ? 'Go back to the order built into the app' : 'This menu is already on the default order'}
            >
              Reset to default
            </Button>
            <Button
              type="button"
              variant="primary" size="md" className="!px-4 !py-2 text-sm"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save order'}
            </Button>
          </div>
        </div>

        <p className="text-xs text-ivory-500">
          Drag a row by its handle, or use the arrows, then save. This applies to{' '}
          <b>{source.who}</b> — on the desktop rail and the phone menu alike — without
          anyone signing in again. Anyone viewing the app picks the change up within a
          minute, or as soon as they switch back to this tab.
        </p>

        <div className="flex flex-wrap gap-2">
          {MENUS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => selectMenu(m.key)}
              className={`perm-tab ${menu === m.key ? 'perm-tab--on' : ''}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="perm-list">
        <div className="perm-row navorder-row navorder-row--head">
          <span className="navorder-head-label">Menu item</span>
          <span style={{ textAlign: 'center' }}>Position</span>
        </div>

        {/* DndContext and SortableContext are context providers and render no DOM
            of their own, so the rows stay direct children of .perm-list and the
            existing grid and border styling is untouched. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext
            items={orderKeys(items)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((link, index) => {
              /* Section headers are visual only: the list stays one flat order
                 with one save, and the headers simply follow the flags wherever
                 rows move. Only the staff menu has owner-only rows. */
              const prev = items[index - 1];
              const startsSuper = menu === 'admin' && link.superOnly && !(prev && prev.superOnly);
              const startsCoach = menu === 'admin' && !link.superOnly && (!prev || prev.superOnly);
              return (
                <Fragment key={link.to}>
                  {(startsSuper || startsCoach) && (
                    <div className="navorder-section" aria-hidden="true">
                      {startsSuper ? 'Super Admin section' : 'Coach section'}
                    </div>
                  )}
                  <SortableRow
                    link={link}
                    index={index}
                    total={items.length}
                    isDropTarget={Boolean(dragging) && dropTarget === link.to && dragging !== link.to}
                    onMove={move}
                  />
                </Fragment>
              );
            })}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {draggingLink && (
              <div className="navorder-overlay">
                <span className="navorder-icon" aria-hidden="true">{draggingLink.icon}</span>
                <span className="flex-1">{draggingLink.label}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {dirty && (
        <p className="text-xs text-gold-400">
          Unsaved changes — they only reach other users once you save.
        </p>
      )}

      {menu === 'admin' && (
        <p className="text-[0.7rem] text-ivory-500/70">
          Every row on this tab is reorderable — including the “Super Admin” console
          entry itself, which opens the console's default section.
        </p>
      )}
    </div>
  );
}

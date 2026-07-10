import {
  EQUIPMENT_SLOT_LABELS,
  ITEM_GRADE_DEFINITIONS,
  ITEM_RARITY_DEFINITIONS,
  ITEM_STAT_LABELS,
  getItem,
  getEnhancedItemStats,
  getClass,
  type ClassId,
  type DerivedCharacterStats,
  type EquipmentLoadout,
  type EquipmentSlot,
  type InventoryView,
  type ItemDefinition,
  type ItemInstance,
  type ItemStatBlock,
} from "@neivara/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEnhancementPreview, getEquipAvailability } from "../inventoryPresentation";

export type ItemAction = "equip" | "unequip" | "use" | "enhance";

interface Props {
  open: boolean;
  characterName: string;
  characterLevel: number;
  characterClassId: ClassId;
  className: string;
  inventory: InventoryView;
  derivedStats: DerivedCharacterStats;
  busyAction: string | null;
  actionsDisabled: boolean;
  error: string | null;
  onClose: () => void;
  onAction: (action: ItemAction, item: ItemInstance, slot?: EquipmentSlot) => Promise<void>;
}

type FilterId = "all" | "equipment" | "consumable" | "material";

const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: "all", label: "Все" },
  { id: "equipment", label: "Снаряжение" },
  { id: "consumable", label: "Расходники" },
  { id: "material", label: "Материалы" },
];

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
  "head",
  "neck",
  "chest",
  "hands",
  "main_hand",
  "off_hand",
  "legs",
  "feet",
  "ear_left",
  "ear_right",
  "ring_left",
  "ring_right",
  "charm",
];

const STAT_ORDER = Object.keys(ITEM_STAT_LABELS) as Array<keyof ItemStatBlock>;

const DERIVED_STAT_ROWS: ReadonlyArray<{
  key: keyof DerivedCharacterStats;
  label: string;
  format?: (value: number) => string;
}> = [
  { key: "maxHp", label: "Здоровье" },
  { key: "maxMp", label: "Энергия" },
  { key: "physicalAttack", label: "Сила атаки" },
  { key: "spellPower", label: "Сила чар" },
  { key: "armor", label: "Броня" },
  { key: "resistance", label: "Сопротивление" },
  { key: "accuracy", label: "Точность" },
  { key: "evasion", label: "Уклонение" },
  { key: "criticalChance", label: "Шанс крит. удара", format: (value) => `${(value * 100).toFixed(1)}%` },
  { key: "hastePercent", label: "Скорость атаки", format: (value) => `${(value * 100).toFixed(1)}%` },
  { key: "moveSpeed", label: "Скорость бега", format: (value) => value.toFixed(2) },
  { key: "basicRange", label: "Дальность атаки", format: (value) => value.toFixed(1) },
  { key: "basicAttackIntervalMs", label: "Интервал атаки", format: (value) => `${Math.round(value)} мс` },
];

function definitionFor(item: ItemInstance): ItemDefinition {
  return getItem(item.itemId);
}

function enhancedStats(item: ItemInstance): ItemStatBlock {
  return getEnhancedItemStats(item.itemId, item.enhancementLevel);
}

function itemColors(definition: ItemDefinition): React.CSSProperties {
  return {
    "--item-primary": definition.visual.primaryColor,
    "--item-accent": definition.visual.accentColor,
  } as React.CSSProperties;
}

function itemGlyph(definition: ItemDefinition): string {
  const supplied = definition.visual.icon.trim();
  if (supplied.length > 0 && supplied.length <= 3) return supplied;
  if (definition.category === "weapon") {
    if (/bow/i.test(definition.weaponType)) return "⌁";
    if (/staff|wand/i.test(definition.weaponType)) return "✦";
    return "†";
  }
  if (definition.category === "armor") return "⬙";
  if (definition.category === "accessory") return "◇";
  if (definition.category === "consumable") return "+";
  return "◆";
}

function ItemIcon({ item, compact = false }: { item: ItemInstance; compact?: boolean }) {
  const definition = definitionFor(item);
  return (
    <span
      className={`item-icon rarity-${definition.rarity}${compact ? " compact" : ""}`}
      style={itemColors(definition)}
      aria-hidden="true"
    >
      <i>{itemGlyph(definition)}</i>
      {item.enhancementLevel > 0 && <b>+{item.enhancementLevel}</b>}
    </span>
  );
}

function formatStat(key: keyof ItemStatBlock, value: number): string {
  if (key === "movementSpeedBps") return `${value > 0 ? "+" : ""}${(value / 100).toFixed(1)}%`;
  return `${value > 0 ? "+" : ""}${value}`;
}

function StatLines({
  stats,
  compare,
  compact = false,
}: {
  stats: ItemStatBlock;
  compare?: ItemStatBlock | undefined;
  compact?: boolean;
}) {
  const populated = STAT_ORDER.filter((key) => typeof stats[key] === "number" && stats[key] !== 0);
  if (populated.length === 0) return compact ? null : <p className="item-no-stats">Не влияет на боевые параметры</p>;
  return (
    <dl className={`item-stat-list${compact ? " compact" : ""}`}>
      {populated.slice(0, compact ? 4 : undefined).map((key) => {
        const value = stats[key] ?? 0;
        const difference = compare ? value - (compare[key] ?? 0) : null;
        return (
          <div key={key}>
            <dt>{ITEM_STAT_LABELS[key]}</dt>
            <dd>
              {formatStat(key, value)}
              {difference !== null && difference !== 0 && (
                <small className={difference > 0 ? "positive" : "negative"}>
                  {difference > 0 ? "▲" : "▼"} {formatStat(key, difference)}
                </small>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ItemTooltip({ item }: { item: ItemInstance }) {
  const definition = definitionFor(item);
  return (
    <span className="item-tooltip" role="tooltip">
      <strong>{definition.name}{item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : ""}</strong>
      <small>{ITEM_RARITY_DEFINITIONS[definition.rarity].name} · {ITEM_GRADE_DEFINITIONS[definition.grade].name}</small>
      <span>{definition.description}</span>
      <StatLines stats={enhancedStats(item)} compact />
    </span>
  );
}

function allowedSlots(definition: ItemDefinition): readonly EquipmentSlot[] {
  if (!("allowedSlots" in definition)) return [];
  return definition.allowedSlots;
}

function comparisonItem(
  definition: ItemDefinition,
  equipment: EquipmentLoadout,
): ItemInstance | undefined {
  for (const slot of allowedSlots(definition)) {
    const equipped = equipment[slot];
    if (equipped) return equipped;
  }
  return undefined;
}

export function InventoryPanel({
  open,
  characterName,
  characterLevel,
  characterClassId,
  className,
  inventory,
  derivedStats,
  busyAction,
  actionsDisabled,
  error,
  onClose,
  onAction,
}: Props) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enhancementConfirmId, setEnhancementConfirmId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");
    return inventory.items.filter((item) => {
      const definition = definitionFor(item);
      const categoryMatches = filter === "all"
        || (filter === "equipment" && ["weapon", "armor", "accessory"].includes(definition.category))
        || definition.category === filter;
      return categoryMatches && (!normalizedQuery
        || definition.name.toLocaleLowerCase("ru").includes(normalizedQuery)
        || definition.description.toLocaleLowerCase("ru").includes(normalizedQuery));
    });
  }, [filter, inventory.items, query]);

  const selected = inventory.items.find((item) => item.instanceId === selectedId) ?? null;
  const selectedDefinition = selected ? definitionFor(selected) : null;
  const compared = selectedDefinition ? comparisonItem(selectedDefinition, inventory.equipment) : undefined;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => previouslyFocused?.focus();
  }, [open]);

  useEffect(() => {
    if (selectedId && !inventory.items.some((item) => item.instanceId === selectedId)) setSelectedId(null);
  }, [inventory.items, selectedId]);

  useEffect(() => {
    if (
      enhancementConfirmId
      && (!open || selected?.instanceId !== enhancementConfirmId)
    ) setEnhancementConfirmId(null);
  }, [enhancementConfirmId, open, selected?.instanceId]);

  if (!open) return null;

  const selectedBusy = selected ? busyAction === selected.instanceId : false;
  const canEquip = selectedDefinition ? allowedSlots(selectedDefinition).length > 0 : false;
  const equipAvailability = selectedDefinition && canEquip
    ? getEquipAvailability(selectedDefinition, {
      level: characterLevel,
      classId: characterClassId,
    })
    : null;
  const enhancementPreview = selected && canEquip
    ? getEnhancementPreview(selected, inventory)
    : null;
  const deferredReturn = selectedDefinition?.category === "consumable"
    && selectedDefinition.effect.kind === "return";
  const canUse = selectedDefinition?.category === "consumable"
    && selectedDefinition.usable
    && selectedDefinition.effect.kind !== "return";

  const quickAction = (item: ItemInstance) => {
    const definition = definitionFor(item);
    if (item.equippedSlot) void onAction("unequip", item, item.equippedSlot);
    else if (definition.category === "consumable" && definition.effect.kind !== "return") {
      void onAction("use", item);
    }
    else if (
      allowedSlots(definition).length > 0
      && getEquipAvailability(definition, {
        level: characterLevel,
        classId: characterClassId,
      }).allowed
    ) void onAction("equip", item);
  };

  return (
    <div
      className="inventory-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="inventory-window hud-panel"
        style={{
          "--equipment-art": `url("${import.meta.env.BASE_URL}assets/concepts/neivara-equipment-sheet.jpg")`,
        } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-heading"
      >
        <header className="inventory-window-header">
          <div>
            <p className="eyebrow">Снаряжение героя</p>
            <h2 id="inventory-heading">Инвентарь</h2>
          </div>
          <div className="inventory-wallet" aria-label={`${inventory.gold} монет`}>
            <span>Казна</span><strong>{inventory.gold.toLocaleString("ru-RU")} ◇</strong>
          </div>
          <button ref={closeButtonRef} className="window-close" onClick={onClose} aria-label="Закрыть инвентарь">
            ×
          </button>
        </header>

        <div className="inventory-layout">
          <section className="paperdoll-column" aria-labelledby="equipment-heading">
            <div className="inventory-section-title">
              <h3 id="equipment-heading">Экипировка</h3>
              <span>{characterLevel} ур.</span>
            </div>
            <div className="paperdoll">
              <div className="paperdoll-figure" aria-hidden="true">
                <span className="figure-head" />
                <span className="figure-body" />
                <span className="figure-arms" />
                <span className="figure-legs" />
                <div><strong>{characterName}</strong><small>{className}</small></div>
              </div>
              {EQUIPMENT_SLOTS.map((slot) => {
                const item = inventory.equipment[slot];
                const definition = item ? definitionFor(item) : null;
                return (
                  <button
                    key={slot}
                    className={`paperdoll-slot slot-${slot}${item?.instanceId === selectedId ? " selected" : ""}`}
                    onClick={() => setSelectedId(item?.instanceId ?? null)}
                    disabled={!item}
                    aria-label={item ? `${EQUIPMENT_SLOT_LABELS[slot]}: ${definition?.name}` : `${EQUIPMENT_SLOT_LABELS[slot]}: пусто`}
                    title={item ? definition?.name : EQUIPMENT_SLOT_LABELS[slot]}
                  >
                    {item ? <ItemIcon item={item} compact /> : <span className="empty-slot-glyph" aria-hidden="true" />}
                    <small>{EQUIPMENT_SLOT_LABELS[slot]}</small>
                  </button>
                );
              })}
            </div>
            <section className="derived-stats" aria-label="Итоговые характеристики">
              <h4>Боевые параметры</h4>
              <dl className="item-stat-list derived">
                {DERIVED_STAT_ROWS.map((row) => (
                  <div key={row.key}>
                    <dt>{row.label}</dt>
                    <dd>{row.format ? row.format(derivedStats[row.key]) : derivedStats[row.key]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </section>

          <section className="bag-column" aria-labelledby="bag-heading">
            <div className="inventory-section-title bag-heading-row">
              <h3 id="bag-heading">Походная сумка</h3>
              <span>{inventory.usedSlots} / {inventory.capacity}</span>
            </div>
            <div className="inventory-tools">
              <div className="inventory-filters" role="tablist" aria-label="Категории предметов">
                {FILTERS.map((entry) => (
                  <button
                    key={entry.id}
                    role="tab"
                    aria-selected={filter === entry.id}
                    className={filter === entry.id ? "active" : ""}
                    onClick={() => setFilter(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <label className="inventory-search">
                <span className="sr-only">Найти предмет</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
              </label>
            </div>
            <div className="item-grid" role="list" aria-label="Предметы в сумке">
              {filteredItems.map((item) => {
                const definition = definitionFor(item);
                return (
                  <button
                    type="button"
                    role="listitem"
                    key={item.instanceId}
                    className={`item-cell rarity-${definition.rarity}${item.instanceId === selectedId ? " selected" : ""}${item.equippedSlot ? " equipped" : ""}`}
                    style={itemColors(definition)}
                    onClick={() => setSelectedId(item.instanceId)}
                    onDoubleClick={() => quickAction(item)}
                    aria-label={`${definition.name}, ${item.quantity} шт.${item.equippedSlot ? ", надето" : ""}`}
                  >
                    <ItemIcon item={item} />
                    {item.quantity > 1 && <span className="item-quantity">{item.quantity}</span>}
                    {item.equippedSlot && <span className="equipped-mark" aria-label="Надето">E</span>}
                    <ItemTooltip item={item} />
                  </button>
                );
              })}
              {Array.from({ length: Math.min(12, Math.max(0, inventory.capacity - inventory.usedSlots)) }, (_, index) => (
                <span className="item-cell empty" key={`empty-${index}`} aria-hidden="true" />
              ))}
              {filteredItems.length === 0 && (
                <p className="inventory-empty">В этой категории ничего не найдено.</p>
              )}
            </div>
            <p className="inventory-help">Один клик — сравнить · двойной клик — использовать или надеть</p>
          </section>

          <aside className="item-detail" aria-label="Сведения о выбранном предмете">
            {selected && selectedDefinition ? (
              <>
                <div className="item-detail-heading">
                  <ItemIcon item={selected} />
                  <div>
                    <p>{ITEM_RARITY_DEFINITIONS[selectedDefinition.rarity].name}</p>
                    <h3>{selectedDefinition.name}{selected.enhancementLevel > 0 ? ` +${selected.enhancementLevel}` : ""}</h3>
                    <small>{ITEM_GRADE_DEFINITIONS[selectedDefinition.grade].name}</small>
                  </div>
                </div>
                <p className="item-description">{selectedDefinition.description}</p>
                <blockquote>{selectedDefinition.lore}</blockquote>
                <StatLines stats={enhancedStats(selected)} compare={compared ? enhancedStats(compared) : undefined} />
                {compared && compared.instanceId !== selected.instanceId && (
                  <p className="comparison-note">Сравнение с «{definitionFor(compared).name}»</p>
                )}
                <p className={characterLevel >= selectedDefinition.requirements.level ? "requirement met" : "requirement unmet"}>
                  Уровень {selectedDefinition.requirements.level}
                </p>
                {selectedDefinition.requirements.classes.length > 0 && (
                  <p className={equipAvailability?.allowed || !equipAvailability?.reasons.some((reason) => reason.startsWith("Подходит только"))
                    ? "requirement met"
                    : "requirement unmet"}
                  >
                    Класс: {selectedDefinition.requirements.classes.map((classId) => getClass(classId).name).join(", ")}
                  </p>
                )}
                {canEquip && equipAvailability && !equipAvailability.allowed && (
                  <p className="inventory-action-note requirement-reason" role="status">
                    Нельзя надеть: {equipAvailability.reasons.join("; ")}.
                  </p>
                )}
                <div className="item-actions">
                  {selected.equippedSlot ? (
                    <button
                      className="primary-item-action"
                      disabled={actionsDisabled || selectedBusy}
                      onClick={() => void onAction("unequip", selected, selected.equippedSlot ?? undefined)}
                    >
                      {selectedBusy ? "Подождите…" : "Снять"}
                    </button>
                  ) : canEquip ? (
                    <button
                      className="primary-item-action"
                      disabled={actionsDisabled || selectedBusy || !equipAvailability?.allowed}
                      title={equipAvailability?.allowed ? undefined : equipAvailability?.reasons.join("; ")}
                      onClick={() => void onAction("equip", selected)}
                    >
                      {selectedBusy ? "Подождите…" : "Надеть"}
                    </button>
                  ) : canUse ? (
                    <button
                      className="primary-item-action"
                      disabled={actionsDisabled || selectedBusy}
                      onClick={() => void onAction("use", selected)}
                    >
                      {selectedBusy ? "Подождите…" : "Использовать"}
                    </button>
                  ) : null}
                  {canEquip && (
                    <button
                      className="secondary-item-action"
                      disabled={actionsDisabled || selectedBusy || enhancementPreview?.atMaximum}
                      onClick={() => setEnhancementConfirmId(selected.instanceId)}
                    >
                      {enhancementPreview?.atMaximum ? "Максимум" : "Усилить"}
                    </button>
                  )}
                </div>
                {enhancementPreview && enhancementConfirmId === selected.instanceId && (
                  <section className="enhancement-confirm" aria-label="Подтверждение усиления">
                    <strong>Усиление до +{enhancementPreview.nextLevel}</strong>
                    <dl>
                      <div>
                        <dt>Шанс успеха</dt>
                        <dd>{(enhancementPreview.chanceBps / 100).toFixed(1)}%</dd>
                      </div>
                      <div>
                        <dt>Монеты</dt>
                        <dd>{enhancementPreview.goldCost.toLocaleString("ru-RU")} ◇</dd>
                      </div>
                      <div>
                        <dt>{enhancementPreview.catalystName}</dt>
                        <dd>{enhancementPreview.catalystRequired} шт. · есть {enhancementPreview.catalystOwned}</dd>
                      </div>
                    </dl>
                    <p>{enhancementPreview.failureDescription}</p>
                    {!enhancementPreview.affordable && (
                      <p className="enhancement-unavailable">Недостаточно монет или катализатора.</p>
                    )}
                    <div>
                      <button type="button" onClick={() => setEnhancementConfirmId(null)}>Отмена</button>
                      <button
                        type="button"
                        className="confirm-enhancement"
                        disabled={actionsDisabled || selectedBusy || !enhancementPreview.affordable}
                        onClick={() => {
                          setEnhancementConfirmId(null);
                          void onAction("enhance", selected);
                        }}
                      >
                        Подтвердить
                      </button>
                    </div>
                  </section>
                )}
                {actionsDisabled && (
                  <p className="inventory-action-note">Действия доступны после восстановления связи с миром.</p>
                )}
                {deferredReturn && (
                  <p className="inventory-action-note">Ритуал возвращения появится вместе с прерываемым серверным cast.</p>
                )}
                <p className="item-value">Цена торговцу: {selectedDefinition.sellPrice.toLocaleString("ru-RU")} ◇</p>
              </>
            ) : (
              <div className="item-detail-empty">
                <span aria-hidden="true">◇</span>
                <strong>Выберите предмет</strong>
                <p>Здесь появятся свойства, сравнение и доступные действия.</p>
              </div>
            )}
            <p className="inventory-action-error" aria-live="polite">{error}</p>
          </aside>
        </div>
      </section>
    </div>
  );
}

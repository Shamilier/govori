export function buildAgentMenuText(selectedAgentId: string | null): string {
  if (selectedAgentId) {
    return [
      `Выбран агент: ${selectedAgentId}`,
      "Детальное меню агента подключим на следующем шаге MVP.",
    ].join("\n");
  }

  return [
    "Агент пока не выбран.",
    "Список агентов и переключение подключим на следующем шаге MVP.",
  ].join("\n");
}

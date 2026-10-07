/**
 * The terminal tool contract, shared by the server that offers it and the device that runs it.
 *
 * <p>This is the single definition of the tool's name, schema and round ceiling. It exists as a
 * shared module because two copies of a tool schema drift: the model would be told one argument
 * shape while the executor expected another, and the failure would look like a model error rather
 * than a deployment mistake. The command timeout, output ceiling and call budget are deliberately
 * <em>not</em> here — they belong to the executor that enforces them on the device, and duplicating
 * them as server constants would create a second limit the server could not actually apply.
 */

/** The only tool name the server will offer or accept a result for. */
export const TERMINAL_TOOL_NAME = "terminal";

/**
 * How many tool round-trips one user turn may take.
 *
 * <p>A turn is several independent HTTP requests — one per round — so nothing on the server bounds
 * the loop on its own. This is that bound. It matches the executor's own round ceiling, and the
 * server refuses to mint a continuation beyond it rather than trusting the client to stop.
 */
export const MAX_TOOL_ROUNDS = 8;

/**
 * The instruction that accompanies the tool in the system prompt.
 *
 * <p>It is added only to the turns that actually advertise the tool, so a turn that cannot run
 * commands is never told about them. The tool description carries the argument contract; this block
 * carries the behavioural rules a description states poorly, and repeats the wording the page-side
 * terminal agent uses so both execution paths tell the model the same thing.
 */
export const TERMINAL_SYSTEM_PROMPT =
  "<ТЕРМИНАЛ>\n" +
  "Ты работаешь в приложении Kairema на Android. У тебя есть единственная функция terminal — встроенный в приложение Linux-терминал (Alpine, выполняется прямо на устройстве пользователя, а не на сервере.\n" +
  "ЛЮБУЮ команду ты выполняешь ТОЛЬКО вызовом функции terminal с аргументом command, в котором передаёшь команду целиком. Никогда не пиши команды в виде обычного текста и не оборачивай их в блоки ```bash: модель, которой доступна эта функция, обязана ею пользоваться, а не демонстрировать команды читателю.\n" +
  "Текущая рабочая директория сохраняется между вызовами, поэтому cd в одной команде влияет на следующую.\n" +
  "Функция возвращает stdout, stderr и exit code. Ненулевой exit code — это результат, а не ошибка: прочитай stderr и реши сам, что делать дальше.\n" +
  "Работай короткими командами и проверяй результат. Не повторяй одну и ту же команду без изменений.\n" +
  "</ТЕРМИНАЛ>";

/** The tool as the model sees it. Forwarded to the provider unchanged. */
export const TERMINAL_TOOL = {
  type: "function" as const,
  function: {
    name: TERMINAL_TOOL_NAME,
    description:
      "Run one command in the Linux Terminal built into this Android app (Alpine, running on the " +
      "user's device, not on any server). Use it for shell work: inspecting or editing files, " +
      "running scripts, installing and building. " +
      "The working directory persists between calls, so `cd` in one call applies to the next. " +
      "Returns stdout, stderr and the exit code; a non-zero exit is normal and is not an error to " +
      "retry blindly. Output is truncated at a fixed size, so read what you need rather than " +
      "dumping a large file. Commands that destroy the system or install packages require the " +
      "user's confirmation and return confirmation_required instead of running.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command line to run in the app's Linux Terminal.",
        },
      },
      required: ["command"],
    },
  },
};

export const TERMINAL_SYSTEM_PROMPT =
  "У тебя есть доступ к функциональному Linux Terminal, встроенному в это Android-приложение (Alpine, выполняется " +
  "на устройстве пользователя, не на сервере). Используй tool_call с именем `terminal`, когда нужно выполнить " +
  "shell-команду: inspect/edit файлов, запустить скрипты, установить или собрать что-то. Рабочая директория " +
  "сохраняется между вызовами, поэтому `cd` в одном вызове применяется к следующему. Возвращаются stdout, " +
  "stderr и exit code; ненулевой exit — это нормально, не нужно ретраить вслепую. Вывод обрезается до " +
  "фиксированного размера, поэтому читай только нужное, а не дампи большие файлы. Команды, которые " +
  "разрушают систему или устанавливают пакеты, требуют подтверждения пользователя и возвращают " +
  "confirmation_required вместо выполнения.";
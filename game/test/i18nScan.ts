import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { parse } from 'svelte/compiler';

/**
 * Поиск русского текста мимо словарей (шаг 52).
 *
 * Разбор, а не регулярка: регулярка путает комментарии со строками. Для `.ts`
 * берутся строковые и шаблонные литералы из дерева TypeScript, для `.svelte` —
 * текст разметки, значения атрибутов и литералы из `<script>` по дереву
 * компилятора Svelte. Комментарии и стили в дерево не попадают.
 *
 * Считаются СТРОКИ файла, где такой литерал есть: две кириллические строки на
 * одной строке кода — одна находка, как и видит её глаз в диффе.
 */

export const GAME = resolve(__dirname, '..');

/** Слои, из которых игроку может приехать текст. `sim` — вывод замеров в терминал, см. план §5. */
export const SCANNED_DIRS = ['src/ui', 'src/core', 'src/render', 'src/platform'];

export const ALLOWLIST_PATH = join(GAME, 'test', 'i18n-allowlist.json');

const CYRILLIC = /[\u0400-\u04FF]/;

export interface Finding {
  readonly line: number;
  readonly text: string;
}

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (entry.endsWith('.svelte') || entry.endsWith('.ts')) out.push(path);
  }
}

/**
 * Диагностика для разработчика, а не текст игрока: брошенные ошибки, сообщения
 * проверок схем данных (`refine`, `addIssue`) и вывод в консоль. Интерфейс не
 * показывает `error.message` игроку ни в одном месте — эти строки видит только
 * тот, кто читает стек или правит `data/*.json`, и они русские по тем же
 * правилам, что и комментарии (план шага 52, §5).
 */
const DIAGNOSTIC_CALLS = new Set(['refine', 'superRefine', 'addIssue', 'regex']);

function isDiagnosticTs(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
    if (ts.isThrowStatement(p)) return true;
    if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText())) return true;
    // `super(message)` в собственном классе ошибки (`IncompatibleSaveError`): игроку
    // экран показывает свой ключ по классу ошибки, а не её текст.
    if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const cls = ts.findAncestor(p, ts.isClassDeclaration);
      if (cls?.name !== undefined && /Error$/.test(cls.name.text)) return true;
    }
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      const callee = p.expression;
      if (DIAGNOSTIC_CALLS.has(callee.name.text)) return true;
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'console') return true;
    }
    if (ts.isFunctionLike(p) || ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

function scanTs(source: string, file: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const text = (node as ts.LiteralLikeNode).text;
      if (CYRILLIC.test(text) && !isDiagnosticTs(node)) {
        found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Ключи дерева Svelte, которые не несут текста игрока. */
const SVELTE_SKIP = new Set(['css', 'comments', 'leadingComments', 'trailingComments', 'metadata', 'parent']);

function scanSvelte(source: string): Finding[] {
  const ast = parse(source, { modern: true });
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const found: Finding[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const n = node as Record<string, unknown>;
    let text: string | undefined;
    if (n.type === 'Text' && typeof n.data === 'string') text = n.data;
    else if (n.type === 'Literal' && typeof n.value === 'string') text = n.value;
    else if (n.type === 'TemplateElement') text = (n.value as { cooked?: string } | undefined)?.cooked;
    if (text !== undefined && CYRILLIC.test(text) && typeof n.start === 'number') {
      found.push({ line: lineOf(n.start), text: text.trim() });
    }
    // Ссылка на раздел справки (`<WikiHelp section="узлы и каркас">`) — якорь в
    // русской статье `wiki/`, а не подпись: справка вне шага (план, §5).
    if (n.type === 'Component' && n.name === 'WikiHelp' && Array.isArray(n.attributes)) {
      visit(n.attributes.filter((a: { name?: string }) => a.name !== 'doc' && a.name !== 'section'));
      visit(n.fragment);
      return;
    }
    for (const [key, value] of Object.entries(n)) {
      if (!SVELTE_SKIP.has(key)) visit(value);
    }
  };
  visit(ast);
  return found;
}

/**
 * Пометка «это не текст игрока»: `i18n-ignore` в комментарии на той же строке
 * или строкой выше. Для id, которые уже записаны в сохранения (`…-пилот`,
 * `наёмник-3`): переименовать их значит сломать загрузку старой роты, а игрок
 * их не видит. Пометка обязана объяснять причину — голая пометка без неё
 * читается как заметённый под ковёр перевод.
 */
const IGNORE_MARK = 'i18n-ignore';

function unmarked(source: string, found: Finding[]): Finding[] {
  const lines = source.split('\n');
  return found.filter((f) => {
    const same = lines[f.line - 1] ?? '';
    // Строка выше считается, только если она сама — комментарий: иначе хвостовая
    // пометка на id заодно спрятала бы подпись на следующей строке.
    const above = (lines[f.line - 2] ?? '').trim();
    const aboveIsComment = /^(\/\/|\/\*|\*|<!--)/.test(above);
    return !same.includes(IGNORE_MARK) && !(aboveIsComment && above.includes(IGNORE_MARK));
  });
}

/** Все находки по сканируемым слоям: путь от `game/` → находки. Файлы без находок не попадают. */
export function scanHardcodedText(): Map<string, Finding[]> {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) collect(join(GAME, dir), files);
  const out = new Map<string, Finding[]>();
  for (const file of files.sort()) {
    const source = readFileSync(file, 'utf8');
    const found = unmarked(source, file.endsWith('.svelte') ? scanSvelte(source) : scanTs(source, file));
    if (found.length > 0) out.set(relative(GAME, file).split('\\').join('/'), found);
  }
  return out;
}

/** Число разных строк файла с находками — единица файла исключений. */
export function lineCount(found: readonly Finding[]): number {
  return new Set(found.map((f) => f.line)).size;
}

#!/usr/bin/env python3
# 一次性开发工具:把编排器新增文案批量写入 05-i18n.ts 的 en/es/fr/de 四字典(键集天然对齐)。
# 为什么要有它:test_i18n 钉"四字典 key 集合完全一致 + 模板 T() 字面量全有译",50 个键 × 4 语手写必漏;
# 脚本只在开发机跑,不进运行时、不进安装副本(tools/ 与 frontend/ 同为开发源码)。
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TPL = HERE.parent / 'frontend' / 'src' / '05-i18n.ts'

# zh 源语言不入字典;下列顺序 = [en, es, fr, de]
NEW = {
    '编辑器回调异常': ['Editor callback error', 'Error en la llamada del editor',
                    "Erreur de rappel de l'éditeur", 'Editor-Rückruf-Fehler'],
    '说明(生成 args 入口)': ['Note (becomes the args entry)', 'Nota (origina la entrada args)',
                        "Note (devient l'entrée args)", 'Hinweis (wird zum args-Einstieg)'],
    '如:调研选题': ['e.g. research topic', 'p. ej. tema de investigación', "ex. sujet d'étude", 'z. B. Recherche-Thema'],
    'prompt(可引用 {{nX}})': ['prompt (can reference {{nX}})', 'prompt (puede referenciar {{nX}})',
                         'prompt (peut référencer {{nX}})', 'Prompt (kann {{nX}} referenzieren)'],
    'model / schema(可空)': ['model / schema (optional)', 'modelo / esquema (opcional)',
                        'modèle / schéma (facultatif)', 'Modell / Schema (optional)'],
    'return 表达式': ['return expression', 'expresión de retorno', 'expression de retour', 'Rückgabe-Ausdruck'],
    '删除节点': ['Delete node', 'Eliminar nodo', 'Supprimer le nœud', 'Knoten löschen'],
    '步骤': ['Step', 'Paso', 'Étape', 'Schritt'],
    '存在错误,无法生成': ['Errors present — cannot generate', 'Hay errores, no se puede generar',
                     'Erreurs présentes — génération impossible', 'Fehler vorhanden — Generierung unmöglich'],
    '先修复生成错误': ['Fix the generation errors first', 'Corrige primero los errores',
                   "Corrigez d'abord les erreurs", 'Zuerst die Generierungsfehler beheben'],
    '保存中…': ['Saving…', 'Guardando…', 'Enregistrement…', 'Speichern…'],
    '保存失败:%1': ['Save failed: %1', 'Error al guardar: %1', "Échec de l'enregistrement : %1",
                 'Speichern fehlgeschlagen: %1'],
    '已并存为 %1(同名草稿内容不同)': ['Kept side by side as %1 (same name, different content)',
                                'Guardado en paralelo como %1 (mismo nombre, contenido distinto)',
                                'Conservé en parallèle sous %1 (même nom, contenu différent)',
                                'Als %1 parallel behalten (gleicher Name, anderer Inhalt)'],
    '已保存: %1': ['Saved: %1', 'Guardado: %1', 'Enregistré : %1', 'Gespeichert: %1'],
    '草稿列表读取失败': ['Could not read the draft list', 'No se pudo leer la lista de borradores',
                     'Lecture de la liste des brouillons impossible', 'Draft-Liste nicht lesbar'],
    '载入草稿…': ['Load draft…', 'Cargar borrador…', 'Charger un brouillon…', 'Draft laden…'],
    '未知草稿版本,不猜': ['Unknown draft version — not guessing', 'Versión de borrador desconocida, no se adivina',
                     'Version de brouillon inconnue — aucune devinette', 'Unbekannte Draft-Version — nichts geraten'],
    '草稿已载入: %1': ['Draft loaded: %1', 'Borrador cargado: %1', 'Brouillon chargé : %1', 'Draft geladen: %1'],
    '(未选项目)': ['(no project selected)', '(sin proyecto seleccionado)', '(aucun projet sélectionné)',
                '(kein Projekt gewählt)'],
    '恢复上次未保存的编辑?': ['Restore the last unsaved edits?', '¿Restaurar la última edición no guardada?',
                        'Restaurer la dernière modification non enregistrée ?',
                        'Zuletzt nicht gespeicherte Änderungen wiederherstellen?'],
    '三角拆解 → 并行检索 → 交叉验证': ['Triangulated split → parallel search → cross-check',
                            'Descomposición triangular → búsqueda paralela → verificación cruzada',
                            'Décomposition triangulaire → recherche parallèle → recoupement',
                            'Aufteilung → parallele Suche → Kreuzprüfung'],
    '调研选题': ['research topic', 'tema de investigación', "sujet d'étude", 'Recherche-Thema'],
    '拆解': ['Decompose', 'Descomponer', 'Décomposer', 'Aufteilen'],
    '检索A': ['Search A', 'Búsqueda A', 'Recherche A', 'Suche A'],
    '检索B': ['Search B', 'Búsqueda B', 'Recherche B', 'Suche B'],
    '检索C': ['Search C', 'Búsqueda C', 'Recherche C', 'Suche C'],
    '交叉验证': ['Cross-check', 'Verificación cruzada', 'Recoupement', 'Kreuzprüfung'],
    '清空画布?': ['Clear the canvas?', '¿Vaciar el lienzo?', 'Vider le canevas ?', 'Leinwand leeren?'],
    '脚本已复制': ['Script copied', 'Script copiado', 'Script copié', 'Skript kopiert'],
    '命令已复制': ['Command copied', 'Comando copiado', 'Commande copiée', 'Befehl kopiert'],
    '复制失败(请手动选中文本)': ['Copy failed (select the text manually)', 'Copia fallida (selecciona el texto a mano)',
                       'Copie impossible (sélectionnez le texte manuellement)',
                       'Kopieren fehlgeschlagen (Text manuell markieren)'],
    '每类起止节点各一个(%1 已存在)': ['One start and one return node each (%1 already exists)',
                           'Un nodo de inicio y uno de retorno (%1 ya existe)',
                           'Un nœud de début et un de fin (%1 existe déjà)',
                           'Je ein Start- und Return-Element (%1 existiert bereits)'],
    '✦ 编排': ['✦ Compose', '✦ Componer', '✦ Composer', '✦ Ablauf bauen'],
    '✦ 编排 Workflow': ['✦ Compose Workflow', '✦ Componer Workflow', '✦ Composer un workflow', '✦ Workflow bauen'],
    'workflow 名': ['workflow name', 'nombre del workflow', 'nom du workflow', 'Workflow-Name'],
    '一句话描述(meta.description)': ['one-line description (meta.description)', 'descripción en una línea (meta.description)',
                            'description en une ligne (meta.description)', 'Kurzbeschreibung (meta.description)'],
    '适配视图': ['Fit view', 'Ajustar vista', 'Ajuster la vue', 'Ansicht anpassen'],
    '覆盖原稿': ['Overwrite original', 'Sobrescribir original', "Écraser l'original", 'Original überschreiben'],
    '保存草稿': ['Save draft', 'Guardar borrador', 'Enregistrer le brouillon', 'Draft speichern'],
    '关闭': ['Close', 'Cerrar', 'Fermer', 'Schließen'],
    '组件 · 点或拖入': ['COMPONENTS · click or drag in', 'COMPONENTES · pulsa o arrastra',
                   'COMPOSANTS · cliquer ou glisser', 'BAUSTEINE · klicken oder ziehen'],
    '◆ Agent 步骤': ['◆ Agent step', '◆ Paso de agente', "◆ Étape d'agent", '◆ Agent-Schritt'],
    '子代理执行一段指令': ['a subagent runs one instruction', 'un subagente ejecuta una instrucción',
                    'un sous-agent exécute une consigne', 'ein Subagent führt einen Auftrag aus'],
    '▷ Start 输入': ['▷ Start input', '▷ Entrada inicial', '▷ Entrée de départ', '▷ Start-Eingabe'],
    'args 入口(每图一个)': ['args entry (one per graph)', 'entrada args (una por grafo)',
                       'entrée args (une par graphe)', 'args-Einstieg (pro Diagramm einer)'],
    '◁ Return 产出': ['◁ Return output', '◁ Resultado final', '◁ Résultat de retour', '◁ Rückgabe'],
    'return 表达式(每图一个)': ['return expression (one per graph)', 'expresión de retorno (una por grafo)',
                        'expression de retour (une par graphe)', 'Rückgabe-Ausdruck (pro Diagramm einer)'],
    '连线:卡片右圆点 → 目标左圆点': ["Connect: card's right dot → target left dot",
                          'Conectar: punto derecho → punto izquierdo del destino',
                          'Connecter : point droit → point gauche de la cible',
                          'Verbinden: rechter Punkt → linker Punkt des Ziels'],
    '平移:拖空白处 · 缩放:滚轮': ['Pan: drag empty space · Zoom: wheel', 'Desplazar: arrastrar hueco · Zoom: rueda',
                         'Déplacer : glisser le vide · Zoom : molette', 'Verschieben: Fläche ziehen · Zoom: Mausrad'],
    '删除:选中后按 Del · 点连线删边': ['Delete: select then Del · click an edge to cut it',
                           'Borrar: seleccionar y Del · clic en una conexión para cortarla',
                           'Supprimer : sélectionner puis Del · cliquer un lien pour le couper',
                           'Löschen: auswählen + Entf · Kante klicken zum Trennen'],
    '保存:⌘/Ctrl + S': ['Save: ⌘/Ctrl + S', 'Guardar: ⌘/Ctrl + S', 'Enregistrer : ⌘/Ctrl + S', 'Speichern: ⌘/Ctrl + S'],
    '执行:终端 Workflow({scriptPath, args})': ['Run: Workflow({scriptPath, args}) in a terminal',
                                 'Ejecutar: Workflow({scriptPath, args}) en una terminal',
                                 'Exécuter : Workflow({scriptPath, args}) dans un terminal',
                                 'Ausführen: Workflow({scriptPath, args}) im Terminal'],
    '复制脚本': ['Copy script', 'Copiar script', 'Copier le script', 'Skript kopieren'],
    '清空画布': ['Clear canvas', 'Vaciar lienzo', 'Vider le canevas', 'Leinwand leeren'],
    '复制执行命令': ['Copy run command', 'Copiar comando', 'Copier la commande', 'Befehl kopieren'],
}
LANGS = ['en', 'es', 'fr', 'de']


def q(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    txt = TPL.read_text(encoding='utf-8')
    lines = txt.split('\n')
    for li, lang in enumerate(LANGS):
        idx = next(i for i, ln in enumerate(lines) if ln == '  %s: {' % lang)
        end = next(i for i in range(idx + 1, len(lines)) if re.match(r'^  \},?$', lines[i]))
        have = set(re.findall(r"^    '((?:[^'\\]|\\.)*)':", '\n'.join(lines[idx:end]), re.M))
        add = []
        for k, v in NEW.items():
            if k in have:
                continue
            add.append('    %s: %s,' % (q(k), q(v[li])))
        if add:
            lines[end:end] = ['    // ── 编排器(1.2.43)──'] + add
        print('%s: +%d 条(原有 %d)' % (lang, len(add), len(have)))
    TPL.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())

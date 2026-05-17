#!/usr/bin/env python3
"""
Patch: flavor 4th field in raw_sessions + stale rollout fix
Target: /root/bin/happy-session-recovery.sh
"""
import sys, os

path = sys.argv[1] if len(sys.argv) > 1 else "/root/bin/happy-session-recovery.sh"

with open(path, 'r') as f:
    content = f.read()

original = content
applied = []

def patch(old, new, label, replace_all=False):
    global content
    n = content.count(old)
    if n == 0:
        print(f"FAIL [{label}]: anchor not found", file=sys.stderr)
        sys.exit(1)
    if replace_all:
        content = content.replace(old, new)
    else:
        content = content.replace(old, new, 1)
    applied.append(f"{label} ({n} occurrence{'s' if n > 1 else ''})")

# ── 1. find_codex_rollout: return newest match ──────────────────────────────
patch(
    '    find "$CODEX_SESSIONS_DIR" -mindepth 3 -maxdepth 4 -type f \\\n'
    '        -name "rollout-*-${tid}.jsonl" -mtime -14 -print -quit 2>/dev/null\n',
    '    find "$CODEX_SESSIONS_DIR" -mindepth 3 -maxdepth 4 -type f \\\n'
    "        -name \"rollout-*-${tid}.jsonl\" -mtime -14 -printf '%T@ %p\\n' 2>/dev/null \\\n"
    "        | sort -rn | head -1 | cut -d' ' -f2-\n",
    '1: find_codex_rollout newest-match'
)

# ── 2. Source 1 emit :claude or :codex (check rollout first) ────────────────
patch(
    '        echo "$uuid:$cwd:$home_dir"\n'
    '    done\n'
    '\n'
    '    # --- Source 2: daemon /list endpoint',
    '        local _s1_rollout\n'
    '        _s1_rollout=$(find_codex_rollout "$uuid" 2>/dev/null || true)\n'
    '        if [ -n "$_s1_rollout" ]; then\n'
    '            echo "$uuid:$cwd:$home_dir:codex"\n'
    '        else\n'
    '            echo "$uuid:$cwd:$home_dir:claude"\n'
    '        fi\n'
    '    done\n'
    '\n'
    '    # --- Source 2: daemon /list endpoint',
    '2: Source 1 emit :claude or :codex'
)

# ── 3. Source 2 emit :claude ────────────────────────────────────────────────
patch(
    '            echo "$claude_uuid:$cwd:$home_dir_val"\n'
    '        done < <(echo "$list_json"',
    '            echo "$claude_uuid:$cwd:$home_dir_val:claude"\n'
    '        done < <(echo "$list_json"',
    '3: Source 2 emit :claude'
)

# ── 4. Source 3a emit :codex (unique: scan_codex_via_mapping) ───────────────
patch(
    '        seen[$_dedup_key]=1\n'
    '        echo "$_tid:$_cwd:$_home"\n'
    '    done < <(scan_codex_via_mapping)\n',
    '        seen[$_dedup_key]=1\n'
    '        echo "$_tid:$_cwd:$_home:codex"\n'
    '    done < <(scan_codex_via_mapping)\n',
    '4: Source 3a emit :codex'
)

# ── 5. Source 3b emit :codex (unique: fd_fallback_count) ────────────────────
patch(
    '        fd_fallback_count=$((fd_fallback_count + 1))\n'
    '        echo "$_tid:$_cwd:$_home"\n'
    '    done < <(scan_codex_via_fd)\n',
    '        fd_fallback_count=$((fd_fallback_count + 1))\n'
    '        echo "$_tid:$_cwd:$_home:codex"\n'
    '    done < <(scan_codex_via_fd)\n',
    '5: Source 3b emit :codex'
)

# ── 6. filter_sessions_for_home: consume 4th field ──────────────────────────
patch(
    'filter_sessions_for_home() {\n'
    '    local target_home="$1"\n'
    '    while IFS=: read -r uuid cwd home_dir; do',
    'filter_sessions_for_home() {\n'
    '    local target_home="$1"\n'
    '    while IFS=: read -r uuid cwd home_dir _flavor; do',
    '6: filter_sessions_for_home _flavor'
)

# ── 7. strip_home_field: consume 4th field ───────────────────────────────────
patch(
    'strip_home_field() {\n'
    '    while IFS=: read -r uuid cwd _home_dir; do',
    'strip_home_field() {\n'
    '    while IFS=: read -r uuid cwd _home_dir _flavor; do',
    '7: strip_home_field _flavor'
)

# ── 8. write_json_snapshot: read flavor from 4th field ──────────────────────
patch(
    '        sessions_json=$(echo "$sessions" | while IFS=: read -r uuid work_dir home_dir; do\n'
    '            local flavor="claude"\n'
    '            local session_file=""\n'
    '            local file_exists="false"\n'
    '            local file_size=0\n'
    '\n'
    '            local rollout=""\n'
    '            rollout=$(find_codex_rollout "$uuid" 2>/dev/null || true)\n'
    '\n'
    '            if [ -n "$rollout" ]; then\n'
    "                # TID has a rollout file -> it's codex\n"
    '                flavor="codex"\n'
    '                if _validate_codex_rollout "$rollout" >/dev/null 2>&1; then\n'
    '                    session_file="$rollout"\n'
    '                else\n'
    '                    session_file=""\n'
    '                fi\n'
    '            else\n'
    '                # No rollout file -> treat as claude\n'
    '                flavor="claude"\n'
    '                local project_encoded\n'
    "                project_encoded=$(echo \"$work_dir\" | sed 's|/|-|g')\n"
    '                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"\n'
    '            fi\n',
    '        sessions_json=$(echo "$sessions" | while IFS=: read -r uuid work_dir home_dir flavor; do\n'
    '            local session_file=""\n'
    '            local file_exists="false"\n'
    '            local file_size=0\n'
    '\n'
    '            if [ "$flavor" = "codex" ]; then\n'
    '                # 4th field says codex -> locate rollout (newest via find_codex_rollout)\n'
    '                local rollout=""\n'
    '                rollout=$(find_codex_rollout "$uuid" 2>/dev/null || true)\n'
    '                if [ -n "$rollout" ] && _validate_codex_rollout "$rollout" >/dev/null 2>&1; then\n'
    '                    session_file="$rollout"\n'
    '                else\n'
    '                    session_file=""\n'
    '                fi\n'
    '            else\n'
    '                # No codex evidence -> treat as claude\n'
    '                flavor="claude"\n'
    '                local project_encoded\n'
    "                project_encoded=$(echo \"$work_dir\" | sed 's|/|-|g')\n"
    '                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"\n'
    '            fi\n',
    '8: write_json_snapshot use flavor from 4th field'
)

# ── 9. peak merge jq: carry flavor (3 occurrences: lines 463, 1186, 1794) ───
patch(
    '.sessions[] | "\\(.claude_id):\\(.working_dir):\\(.home_dir // "")"',
    '.sessions[] | "\\(.claude_id):\\(.working_dir):\\(.home_dir // ""):\\(.flavor // "claude")"',
    '9: peak merge jq carry flavor',
    replace_all=True
)

if content == original:
    print("ERROR: no changes were made", file=sys.stderr)
    sys.exit(1)

tmp = path + '.patch.tmp'
with open(tmp, 'w') as f:
    f.write(content)
os.rename(tmp, path)

print(f"SUCCESS: {len(applied)} patches applied to {path}")
for p in applied:
    print(f"  {p}")

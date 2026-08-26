---
name: audit-codebase
description: "Codebase health audit scoring 7 categories with progression plan"
argument-hint: "[path] [--focus security|performance|quality]"
---

# Codebase Health Audit

Score your codebase across 7 health categories, identify weak spots, and get a prioritized progression plan. Each category is scored 1-10 with specific, actionable findings.

**Time**: 3-8 minutes depending on codebase size | **Scope**: Full project

## Instructions

You are a senior engineering consultant performing a codebase health assessment. Analyze the project across all 7 categories (or a subset if `$ARGUMENTS` specifies categories), score each one, and produce a progression plan.

If `$ARGUMENTS` contains category names (e.g., "secrets security tests"), only audit those categories. Otherwise, audit all 7.

---

### Category 1: Secrets (Weight: 15%)

Scan for hardcoded credentials, API keys, and sensitive data in code.

```bash
# API keys and tokens in code
grep -rn --include="*.{js,ts,py,go,java,rb,php,yaml,yml,json,toml,env,cfg,ini,conf}" \
  -E '(?i)(api[_-]?key|apikey|secret[_-]?key|password|passwd|token|bearer)\s*[=:]\s*["'\''"][^"'\'']{8,}' \
  --exclude-dir={node_modules,vendor,.git,dist,build,target,__pycache__,.venv} . 2>/dev/null | head -20

# Known provider patterns
grep -rn -E 'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xox[bps]-[a-zA-Z0-9\-]{20,}' \
  --exclude-dir={node_modules,vendor,.git,dist,build,target} . 2>/dev/null | head -10

# .env files committed
find . -name ".env*" -not -name ".env.example" -not -path "*/node_modules/*" -not -path "*/.git/*" -type f 2>/dev/null

# .gitignore coverage
[ -f ".gitignore" ] && {
  for pattern in ".env" "*.pem" "*.key" "*.p12"; do
    grep -q "$pattern" .gitignore 2>/dev/null && echo "OK: $pattern in .gitignore" || echo "MISSING: $pattern not in .gitignore"
  done
}
```

**Scoring:**
- 10: Zero secrets, .gitignore covers all sensitive patterns, .env.example exists
- 7-9: No secrets in code, minor .gitignore gaps
- 4-6: 1-3 potential secrets found (may be false positives), or .env committed
- 1-3: Multiple secrets in code, private keys committed, no .gitignore protection

---

### Category 2: Security (Weight: 15%)

Check for OWASP-style vulnerabilities and unsafe patterns.

```bash
# SQL injection patterns
grep -rn --include="*.{js,ts,py,java,go,rb,php}" \
  -E '(query|execute|exec)\s*\(\s*[`"'\''"].*\+|\$\{|%s|\.format\(' \
  --exclude-dir={node_modules,vendor,.git,dist,build,target,test,__test__} . 2>/dev/null | head -15

# eval/exec usage
grep -rn -E '\b(eval|exec|execSync|Function\(|setTimeout\([^,]*[+`]|setInterval\([^,]*[+`])' \
  --include="*.{js,ts,py}" --exclude-dir={node_modules,vendor,.git,dist} . 2>/dev/null | head -10

# Unsafe deserialization
grep -rn -E '(pickle\.loads|yaml\.load\(|JSON\.parse\(.*user|unserialize\()' \
  --exclude-dir={node_modules,vendor,.git,dist} . 2>/dev/null | head -10

# Missing input validation on routes/endpoints
grep -rn -E '(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete))' \
  --include="*.{js,ts}" --exclude-dir={node_modules,.git,dist} . 2>/dev/null | wc -l
```

**Scoring:**
- 10: No injection patterns, no eval/exec, input validation on all endpoints, CSP headers
- 7-9: Minor issues (1-2 eval usages in non-user-facing code)
- 4-6: Some injection patterns, missing validation on several endpoints
- 1-3: Active SQL injection risk, eval with user input, no input sanitization

---

### Category 3: Dependencies (Weight: 15%)

Audit package health, known CVEs, and freshness.

```bash
# Node.js audit
[ -f "package-lock.json" ] && npm audit --json 2>/dev/null | jq '.metadata.vulnerabilities' 2>/dev/null
[ -f "package.json" ] && npx npm-check 2>/dev/null | tail -20

# Python
[ -f "requirements.txt" ] && pip-audit -r requirements.txt 2>/dev/null | tail -20
[ -f "pyproject.toml" ] && pip-audit 2>/dev/null | tail -20

# Rust
[ -f "Cargo.toml" ] && cargo audit 2>/dev/null | tail -20

# Go
[ -f "go.mod" ] && govulncheck ./... 2>/dev/null | tail -20

# Lockfile presence
for lockfile in package-lock.json yarn.lock pnpm-lock.yaml Cargo.lock go.sum poetry.lock; do
  [ -f "$lockfile" ] && echo "OK: $lockfile exists"
done
[ ! -f "package-lock.json" ] && [ ! -f "yarn.lock" ] && [ ! -f "pnpm-lock.yaml" ] && [ -f "package.json" ] && echo "MISSING: No lockfile for Node.js project"
```

**Scoring:**
- 10: Zero CVEs, lockfile present, all dependencies <6 months old
- 7-9: No critical/high CVEs, minor outdated packages
- 4-6: 1-3 high CVEs, or >50% dependencies outdated by a year+
- 1-3: Critical CVEs, no lockfile, abandoned dependencies

---

### Category 4: Structure (Weight: 10%)

Evaluate file organization, naming conventions, and module boundaries.

```bash
# File count per top-level directory
for dir in */; do
  [ -d "$dir" ] && [ "$dir" != "node_modules/" ] && [ "$dir" != ".git/" ] && [ "$dir" != "vendor/" ] && \
    echo "$dir: $(find "$dir" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | wc -l) files"
done

# Deeply nested files (complexity indicator)
find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/vendor/*" -mindepth 6 2>/dev/null | head -10

# Mixed naming conventions
find . -type f -name "*_*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -5
find . -type f -name "*-*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -5

# Circular dependency indicators (for JS/TS projects)
[ -f "package.json" ] && npx madge --circular --extensions ts,js src/ 2>/dev/null | head -20
```

**Scoring:**
- 10: Clear module boundaries, consistent naming, no circular deps, flat hierarchy
- 7-9: Good structure with minor inconsistencies
- 4-6: Mixed conventions, some circular deps, unclear module boundaries
- 1-3: No clear structure, deeply nested files, widespread circular deps

---

### Category 5: Tests (Weight: 15%)

Assess test coverage, test quality, and testing practices.

**Three rules, learned the hard way (2026-08-26). Read before scoring.**

1. **Never let build output into the denominator.** The previous version excluded
   only `node_modules`/`.git`/`dist`, so `.next/` (2,234 generated files here)
   counted as source. The same repo scored a 0.05 ratio with a build present and
   0.21 without. That is not a measurement; it is local state. This is the real
   cause of the "counting discrepancy" between the W34 (0.22) and W35 (0.17)
   reports — neither number described the codebase.
2. **Count test CASES, not just files.** A file-count ratio punishes dense,
   well-organised test files and rewards splitting one file into ten. Here 1,646
   cases live in 179 files; fragmenting them would triple a file ratio while
   testing nothing new.
3. **Scope the denominator to what the project declares as coverable.** Use the
   coverage tool's own `include` globs. Counting every `.ts` in the repo drags in
   one-off scripts, config and pages that are not unit-testable in isolation, so
   the score measures repo shape rather than testing discipline.

```bash
# Which files the project itself declares as the coverage surface.
# (vitest.config.ts `include:` — here lib/**/*.ts + app/api/**/*.ts)
grep -A3 "coverage:" vitest.config.* 2>/dev/null | grep "include:"

COVERED_SRC=$(find lib app/api -type f -name "*.ts" ! -name "*.test.*" ! -name "*.d.ts" 2>/dev/null | wc -l)
TEST_FILES=$(find tests -type f \( -name "*.test.*" -o -name "*.spec.*" \) 2>/dev/null | wc -l)
# Test CASES — it(...) / test(...) declarations, the unit of actual assertion.
TEST_CASES=$(grep -rhoE "^[[:space:]]*(it|test)(\.[a-z]+)?\(" tests 2>/dev/null | wc -l)
echo "Test cases: $TEST_CASES in $TEST_FILES files | Coverage-surface source files: $COVERED_SRC"
echo "Cases per source file: $(echo "scale=2; $TEST_CASES / ($COVERED_SRC + 1)" | bc)"

# Coverage: prefer a real report, fall back to the ENFORCED floor.
if [ -f "coverage/coverage-summary.json" ]; then
  jq '.total | {statements:.statements.pct, branches:.branches.pct, functions:.functions.pct, lines:.lines.pct}' coverage/coverage-summary.json
else
  echo "No coverage report in this clone — reading the ENFORCED thresholds instead:"
  grep -A6 "thresholds:" vitest.config.* 2>/dev/null
fi

# Is the suite actually gated in CI? An unenforced test suite is documentation.
grep -rlE "npm (run )?test|vitest|jest" .github/workflows/ 2>/dev/null

# Snapshot maintenance burden
find . -name "*.snap" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | wc -l
```

**Scoring** — weight ENFORCEMENT over volume. A suite CI does not gate is
documentation, and a coverage floor set far below the real number is decoration,
not a gate: it will pass a large regression without complaining.

- **10**: enforced coverage floor ≥70%, CI-gated, floor raised within the last
  quarter, no stale snapshots
- **8-9**: enforced floor ≥50%, CI-gated, floor within ~10pp of actual coverage
- **6-7**: enforced floor ≥25%, CI-gated, floor within ~10pp of actual, and ≥2
  test cases per coverage-surface source file
- **4-5**: tests exist and run in CI, but no enforced floor — or a floor >10pp
  below actual, which gates nothing
- **1-3**: no CI test run, or no meaningful suite

Do **not** deduct for a low case-per-file ratio when coverage is enforced and
ratcheting; say what would raise the floor instead. If a number moves between
weeks, reconcile it against the previous report before calling it a regression —
a change in counting method is not a change in the codebase, and must be reported
as a methodology note rather than a score movement.

---

### Category 6: Imports (Weight: 10%)

Check for unused imports, circular dependencies, and type coverage.

```bash
# Unused imports (TypeScript/JavaScript)
[ -f "tsconfig.json" ] && npx tsc --noEmit 2>&1 | grep -c "declared but" 2>/dev/null
[ -f "tsconfig.json" ] && npx tsc --noEmit 2>&1 | grep "declared but" | head -10

# TypeScript strict mode
[ -f "tsconfig.json" ] && grep -E '"strict"|"noImplicitAny"|"strictNullChecks"' tsconfig.json 2>/dev/null

# Python unused imports
[ -f "pyproject.toml" ] || [ -f "setup.py" ] && python -m pyflakes . 2>/dev/null | grep "imported but unused" | head -10

# Wildcard imports (code smell)
grep -rn 'import \*' --include="*.{py,ts,js}" --exclude-dir={node_modules,vendor,.git} . 2>/dev/null | head -10
```

**Scoring:**
- 10: Zero unused imports, TypeScript strict mode, no wildcard imports
- 7-9: <5 unused imports, strict mode enabled with minor gaps
- 4-6: 5-20 unused imports, no strict mode, some wildcard imports
- 1-3: >20 unused imports, widespread wildcard imports, no type checking

---

### Category 7: AI Patterns (Weight: 20%)

Evaluate Claude Code configuration maturity and AI-assisted development readiness.

```bash
# CLAUDE.md presence and quality
[ -f "CLAUDE.md" ] && echo "OK: CLAUDE.md exists ($(wc -l < CLAUDE.md) lines)" || echo "MISSING: No CLAUDE.md"
[ -f ".claude/settings.json" ] && echo "OK: .claude/settings.json exists" || echo "MISSING: No .claude/settings.json"

# Custom commands
COMMANDS=$(find .claude/commands -name "*.md" 2>/dev/null | wc -l)
echo "Custom commands: $COMMANDS"

# Hooks
HOOKS_CFG=$(grep -c "hooks" .claude/settings.json 2>/dev/null || echo "0")
echo "Hook configurations: $HOOKS_CFG"

# Rules files
RULES=$(find .claude/rules -name "*.md" 2>/dev/null | wc -l)
echo "Rule files: $RULES"

# Agents
AGENTS=$(find .claude/agents -name "*.md" 2>/dev/null | wc -l)
echo "Agent definitions: $AGENTS"

# Skills
SKILLS=$(find .claude/skills -name "*.md" 2>/dev/null | wc -l)
echo "Skills: $SKILLS"

# .gitignore for AI artifacts
grep -q "claude" .gitignore 2>/dev/null && echo "OK: Claude patterns in .gitignore" || echo "INFO: No Claude patterns in .gitignore"
```

**Scoring:**
- 10: CLAUDE.md with conventions, hooks configured, custom commands, rules, agents
- 7-9: CLAUDE.md exists with project context, some commands or rules
- 4-6: Basic CLAUDE.md, no hooks or commands
- 1-3: No CLAUDE.md or empty CLAUDE.md

---

## Scoring & Report

### Overall Score Calculation

```
Overall = (Secrets * 0.15) + (Security * 0.15) + (Dependencies * 0.15) +
          (Structure * 0.10) + (Tests * 0.15) + (Imports * 0.10) +
          (AI Patterns * 0.20)
```

Round to one decimal place.

### Output Format

```markdown
## Codebase Health Audit

**Project**: [directory name]
**Date**: [timestamp]
**Categories audited**: [all 7 or filtered subset]

### Overall Score: [X.X] / 10

| Category | Score | Weight | Weighted | Key Finding |
|----------|-------|--------|----------|-------------|
| Secrets | X/10 | 15% | X.XX | [one-line summary] |
| Security | X/10 | 15% | X.XX | [one-line summary] |
| Dependencies | X/10 | 15% | X.XX | [one-line summary] |
| Structure | X/10 | 10% | X.XX | [one-line summary] |
| Tests | X/10 | 15% | X.XX | [one-line summary] |
| Imports | X/10 | 10% | X.XX | [one-line summary] |
| AI Patterns | X/10 | 20% | X.XX | [one-line summary] |
| **Overall** | | **100%** | **X.XX** | |

### Trend vs the previous report

**Read the prior score out of the file. Never recall it.**

```bash
ls -1 docs/weekly-reports/*.md | grep -vE "devlog|spec-drift" | tail -3
grep -E "\*\*Total\*\*|Overall Score" docs/weekly-reports/<previous>.md
```

Quote the previous total and each previous category score from that file, then
state the delta. If no prior report exists, say so — do not supply a baseline
from memory.

This section exists because the 2026-W35 report opened with "W33: 86.0 / 100
(baseline)" when W33's own table totals **77.0**, and W34 states its predecessor
explicitly. That invented baseline turned W34's **+4.0** — the largest gain in
the series — into a narrated "−5.0 regression", and sent the humans looking for
a fix to a drop that never happened. The category tables are computed from the
repo and are trustworthy; a remembered trend line is not.

### Detailed Findings

#### 🔴 Critical (fix immediately)
- [Finding with file:line reference and concrete fix]

#### 🟡 Warning (fix this week)
- [Finding with context and suggested approach]

#### 🟢 Info (nice to improve)
- [Observation with optional suggestion]

### Progression Plan

[Based on overall score, show the appropriate tier]

#### Tier 1: Foundation (current score <5, target: 5)
Focus on eliminating critical risks before anything else.

| Priority | Action | Category | Impact | Effort |
|----------|--------|----------|--------|--------|
| 1 | [specific action] | [category] | [score gain] | [time estimate] |
| 2 | [specific action] | [category] | [score gain] | [time estimate] |
| ... | | | | |

#### Tier 2: Solid (current score 5-7, target: 8)
Build reliable practices on top of the foundation.

| Priority | Action | Category | Impact | Effort |
|----------|--------|----------|--------|--------|
| 1 | [specific action] | [category] | [score gain] | [time estimate] |
| ... | | | | |

#### Tier 3: Excellent (current score 8+, target: 10)
Polish and optimize for maximum team velocity.

| Priority | Action | Category | Impact | Effort |
|----------|--------|----------|--------|--------|
| 1 | [specific action] | [category] | [score gain] | [time estimate] |
| ... | | | | |

### Quick Wins (< 30 minutes each)
1. [Action that improves score with minimal effort]
2. [...]
3. [...]
```

### Severity Split

Approximately 70% of findings should be automatable (scripts, linters, CI checks can detect them). Flag the remaining 30% as requiring human judgment, and explain why automation falls short for those cases.

---

**Sources**:
- Variant Systems codebase analyzer plugin (variantsystems.io, Feb 2026): 7-category analysis framework
- OWASP Top 10 (2021): Security category patterns
- Claude Code Security Hardening Guide: AI Patterns category baseline

$ARGUMENTS

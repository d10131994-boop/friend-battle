const RELEASE_BRANCH_RE = /^friend-battle-(\d+)-release$/;
const TASK_BRANCH_RE = /^friend-battle-(\d+)\/(.+)$/;

function releaseNumberFromBranch(name) {
  const match = name.match(RELEASE_BRANCH_RE);
  return match ? Number(match[1]) : null;
}

function taskInfo(name) {
  const match = name.match(TASK_BRANCH_RE);
  if (!match) return null;
  const releaseNumber = Number(match[1]);
  const suffix = match[2];
  const aiMatch = suffix.match(/^(.*)-AI(?:-\d+)?$/);
  return {
    releaseNumber,
    isAI: Boolean(aiMatch),
    parent: aiMatch
      ? "friend-battle-" + String(releaseNumber).padStart(2, "0") + "/" + aiMatch[1]
      : null,
  };
}

function getOpenPRRefs(pulls) {
  const refs = new Set();
  for (const pr of pulls) {
    if (pr.head && pr.head.ref) refs.add(pr.head.ref);
    if (pr.base && pr.base.ref) refs.add(pr.base.ref);
  }
  return refs;
}

async function getSnapshot(github, owner, repo) {
  const branches = await github.paginate(github.rest.repos.listBranches, {
    owner, repo, per_page: 100,
  });
  const releases = [...new Set(
    branches.map(branch => releaseNumberFromBranch(branch.name))
      .filter(value => value !== null)
  )].sort((a, b) => b - a);

  if (releases.length === 0) {
    throw new Error("Не найдены релизные ветки friend-battle-NN-release; очистка отменена.");
  }

  const pulls = await github.paginate(github.rest.pulls.list, {
    owner, repo, state: "open", per_page: 100,
  });

  return {
    branches,
    names: new Set(branches.map(branch => branch.name)),
    protectedGenerations: new Set(releases.slice(0, 2)),
    releases,
    openPRRefs: getOpenPRRefs(pulls),
  };
}

async function compare(github, owner, repo, base, head) {
  const response = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: base + "..." + head,
  });
  return response.data;
}

async function classifyBranch(github, owner, repo, branch, snapshot) {
  const name = branch.name;

  if (name === "main") {
    return { name, sha: branch.commit.sha, status: "KEEP", reason: "основная ветка" };
  }

  if (branch.protected) {
    return { name, sha: branch.commit.sha, status: "KEEP", reason: "защищённая GitHub ветка" };
  }

  if (RELEASE_BRANCH_RE.test(name)) {
    return { name, sha: branch.commit.sha, status: "KEEP", reason: "релизные ветки не удаляются никогда" };
  }

  const info = taskInfo(name);
  if (!info) {
    return { name, sha: branch.commit.sha, status: "KEEP", reason: "нестандартное имя — ручная проверка" };
  }

  if (snapshot.protectedGenerations.has(info.releaseNumber)) {
    return {
      name,
      sha: branch.commit.sha,
      status: "KEEP",
      reason: "защищённая зона: одно из двух последних поколений релизов",
    };
  }

  if (snapshot.openPRRefs.has(name)) {
    return { name, sha: branch.commit.sha, status: "KEEP", reason: "ветка участвует в открытом pull request" };
  }

  try {
    if (info.isAI) {
      if (!snapshot.names.has(info.parent)) {
        return {
          name, sha: branch.commit.sha, status: "KEEP",
          reason: "не найдена родительская task-ветка: " + info.parent,
        };
      }

      if (snapshot.openPRRefs.has(info.parent)) {
        return {
          name, sha: branch.commit.sha, status: "KEEP",
          reason: "у родительской ветки открыт pull request: " + info.parent,
        };
      }

      const result = await compare(github, owner, repo, info.parent, name);
      if (result.ahead_by === 0 && !result.too_large) {
        return {
          name, sha: branch.commit.sha, status: "CANDIDATE", isAI: true, parent: info.parent,
          reason: "AI-изменения уже содержатся в родительской ветке " + info.parent,
        };
      }

      return {
        name, sha: branch.commit.sha, status: "KEEP",
        reason: result.too_large
          ? "сравнение слишком большое — нужна ручная проверка"
          : "есть " + (result.ahead_by ?? "неизвестно") + " уникальных коммитов относительно родительской ветки",
      };
    }

    const result = await compare(github, owner, repo, "main", name);
    if (result.ahead_by === 0 && !result.too_large) {
      return {
        name, sha: branch.commit.sha, status: "CANDIDATE", isAI: false,
        reason: "нет уникальных коммитов относительно main",
      };
    }

    return {
      name, sha: branch.commit.sha, status: "KEEP",
      reason: result.too_large
        ? "сравнение слишком большое — нужна ручная проверка"
        : "есть " + (result.ahead_by ?? "неизвестно") + " уникальных коммитов относительно main",
    };
  } catch (error) {
    return {
      name, sha: branch.commit.sha, status: "KEEP",
      reason: "ошибка проверки GitHub API — оставляем в безопасности: " + error.message,
    };
  }
}

async function classifyAll(github, owner, repo, snapshot) {
  const rows = [];
  for (const branch of snapshot.branches) {
    rows.push(await classifyBranch(github, owner, repo, branch, snapshot));
  }

  // Не удаляем родительскую task-ветку, если хотя бы одна её AI-ветка
  // осталась на хранении по любой причине.
  for (const row of rows) {
    if (row.status !== "CANDIDATE" || row.isAI) continue;
    const retainedChild = rows.find(child => {
      const info = taskInfo(child.name);
      return info && info.isAI && info.parent === row.name && child.status !== "CANDIDATE";
    });
    if (retainedChild) {
      row.status = "KEEP";
      row.reason = "связана с AI-веткой, оставленной для сохранения: " + retainedChild.name;
    }
  }

  return rows;
}

function makeReport(snapshot, rows, title) {
  const candidates = rows.filter(row => row.status === "CANDIDATE");
  const kept = rows.filter(row => row.status === "KEEP");
  const generations = snapshot.releases.slice(0, 2)
    .map(value => String(value).padStart(2, "0")).join(", ");

  const lines = [
    "## " + title,
    "",
    "- Последний найденный релиз: **" + String(snapshot.releases[0]).padStart(2, "0") + "**",
    "- Сохраняем два последних поколения релизов: **" + generations + "**",
    "- Кандидаты: **" + candidates.length + "**",
    "- Сохранено: **" + kept.length + "**",
    "",
    "### Кандидаты",
    "",
    ...(candidates.length
      ? candidates.map(row => "- " + row.name + " — " + row.reason)
      : ["- Нет"]),
    "",
    "### Сохранённые ветки",
    "",
    ...kept.map(row => "- " + row.name + " — " + row.reason),
  ];

  return { lines, candidates, kept };
}

module.exports = async function runBranchCleanup({ github, context, core, mode }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  if (mode === "auto") {
    if (context.eventName !== "push" || context.ref !== "refs/heads/main") {
      core.setFailed("Автоматическое удаление разрешено только после push в main.");
      return;
    }
  } else if (mode === "delete") {
    const confirmation = process.env.CONFIRM_DELETE || "";
    if (confirmation !== "DELETE") {
      core.setFailed("Удаление не запущено. Для ручного запуска необходимо ввести точное подтверждение DELETE.");
      return;
    }
    if (context.eventName !== "workflow_dispatch") {
      core.setFailed("Ручное удаление разрешено только при workflow_dispatch.");
      return;
    }
  } else if (mode !== "report") {
    core.setFailed("Неизвестный режим очистки: " + mode);
    return;
  }

  const initialSnapshot = await getSnapshot(github, owner, repo);
  const initialRows = await classifyAll(github, owner, repo, initialSnapshot);
  const initialReport = makeReport(
    initialSnapshot,
    initialRows,
    mode === "report" ? "Branch cleanup audit — dry run" : "Branch cleanup — pre-delete audit"
  );

  if (mode === "report") {
    initialReport.lines.push("", "> Ничего не удалено. Это только отчёт.");
    await core.summary.addRaw(initialReport.lines.join("\n")).write();
    core.info("Audit completed: " + initialReport.candidates.length + " candidates, " + initialReport.kept.length + " kept.");
    return;
  }

  const deleted = [];
  const skipped = [];
  const orderedCandidates = [...initialReport.candidates].sort((a, b) => {
    return Number(Boolean(b.isAI)) - Number(Boolean(a.isAI));
  });

  for (const original of orderedCandidates) {
    try {
      // Обновляем список веток и PR непосредственно перед каждым удалением.
      const currentSnapshot = await getSnapshot(github, owner, repo);
      const currentBranch = currentSnapshot.branches.find(branch => branch.name === original.name);

      if (!currentBranch) {
        skipped.push({ name: original.name, reason: "ветка уже отсутствует" });
        continue;
      }

      if (currentBranch.commit.sha !== original.sha) {
        skipped.push({ name: original.name, reason: "SHA ветки изменился после аудита" });
        continue;
      }

      const currentRow = await classifyBranch(github, owner, repo, currentBranch, currentSnapshot);
      if (currentRow.status !== "CANDIDATE") {
        skipped.push({ name: original.name, reason: "повторная проверка не подтвердила кандидата: " + currentRow.reason });
        continue;
      }

      // AI-ветки удаляются раньше родителей. Если AI-ветка не удалилась,
      // родительская task-ветка останется нетронутой.
      if (!currentRow.isAI) {
        const remainingAIChild = currentSnapshot.branches.find(branch => {
          const info = taskInfo(branch.name);
          return info && info.isAI && info.parent === original.name;
        });
        if (remainingAIChild) {
          skipped.push({ name: original.name, reason: "связь с AI-веткой ещё существует: " + remainingAIChild.name });
          continue;
        }
      }

      await github.rest.git.deleteRef({
        owner,
        repo,
        ref: "heads/" + original.name,
      });
      deleted.push(original.name);
      core.info("Deleted obsolete branch: " + original.name);
    } catch (error) {
      skipped.push({ name: original.name, reason: "GitHub API отказал в удалении; ветка сохранена: " + error.message });
    }
  }

  const lines = [
    "## Branch cleanup — deletion result",
    "",
    "- Режим: **" + (mode === "auto" ? "автоматическая очистка после обновления main" : "ручное удаление с подтверждением DELETE") + "**",
    "- Кандидатов в исходном аудите: **" + initialReport.candidates.length + "**",
    "- Удалено: **" + deleted.length + "**",
    "- Пропущено: **" + skipped.length + "**",
    "",
    "### Удалённые ветки",
    "",
    ...(deleted.length ? deleted.map(name => "- " + name) : ["- Нет"]),
    "",
    "### Сохранённые при повторной проверке",
    "",
    ...(skipped.length
      ? skipped.map(item => "- " + item.name + " — " + item.reason)
      : ["- Нет"]),
    "",
    "> Каждая ветка повторно проверялась непосредственно перед удалением. Ошибки приводили к пропуску ветки.",
  ];

  await core.summary.addRaw(lines.join("\n")).write();
  core.info("Cleanup finished: " + deleted.length + " deleted, " + skipped.length + " skipped.");
};

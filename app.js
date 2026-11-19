// === ЧАСТЬ 3: Импорт/бэкапы, связывание с каталогом, Канбан, Персонажи, Полная страница, Битва тайтлов и Навигация (app.js) ===
// ---------- Управление данными (💾), Пакетные операции, Поиск и объединение повторов (🧹), Связь с каталогом (🔗), Разобрать (📥) и Импорт (Бэкап, Кинопоиск, MAL/Shikimori/AniList) ----------

function openDataManagementModal() {
  $('accMenu')?.classList.remove('open');
  $('hybMorePop')?.classList.remove('open');
  updateLastImportBatchBarUI();
  $('dataModal').style.display = 'flex';
}
if ($('accDataBtn')) $('accDataBtn').onclick = openDataManagementModal;
if ($('profDataModalBtn')) $('profDataModalBtn').onclick = openDataManagementModal;
if ($('closeDataModalBtn')) $('closeDataModalBtn').onclick = () => hideModalElement('dataModal');

$('accKey').onclick = async () => {
  let cur = ''; try { cur = localStorage.getItem('tmdbKey') || ''; } catch (e) {}
  const v = await uiPrompt('Свой ключ TMDB (необязательно — общий ключ уже встроен)', cur, 'Оставь пустым для использования встроенного ключа');
  if (v === null) return;
  try { if (v.trim()) localStorage.setItem('tmdbKey', v.trim()); else localStorage.removeItem('tmdbKey'); } catch (e) {}
  toast(v.trim() ? 'Свой ключ TMDB сохранён' : 'Включён встроенный общий ключ TMDB');
};
$('accReset').onclick = async () => {
  if (!(await uiConfirm('Сбросить оформление (цвет, тема, размер карточек, вид)? Коллекция не пострадает.', 'Сбросить'))) return;
  try { ['acc', 'cw', 'profHide', 'view', 'cgHid', 'draft', 'theme', 'cgTagStateV2'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
  location.reload();
};

// Пакетное сохранение и удаление в Firestore с локальным страховочным сохранением ДО облака и очередью dirty/pendingDeletes
async function batchSaveItems(listToSave, opts = {}) {
  if (!listToSave || !listToSave.length) return { synced: true, localSaved: true };
  const requireCloud = Boolean(opts && opts.requireCloud);
  const now = Date.now();
  listToSave.forEach(it => {
    it.updatedAt = now;
    it.dirty = true;
    fix(it);
  });
  saveLocalItems();

  if (!user || user.isLocal) {
    listToSave.forEach(it => { delete it.dirty; });
    saveLocalItems();
    setSync();
    return { synced: true, localSaved: true };
  }

  if (typeof isCloudWriteBlocked === 'function' && isCloudWriteBlocked()) {
    setSync();
    if (requireCloud) {
      const err = new Error('Облако временно недоступно (' + (cloudAccessError || 'offline') + ')');
      err.code = cloudAccessError || 'unavailable';
      throw err;
    }
    return { synced: false, localSaved: true };
  }

  try {
    for (let i = 0; i < listToSave.length; i += 350) {
      const chunk = listToSave.slice(i, i + 350);
      const b = writeBatch(db);
      chunk.forEach(it => {
        const { docId, payload } = prepareTitleForCloud(it, user.uid);
        b.set(doc(db, 'items', docId), payload);
      });
      await track(b.commit());
      chunk.forEach(it => { delete it.dirty; });
    }
    saveLocalItems();
    if (typeof scheduleColRevBump === 'function') scheduleColRevBump();
    setSync();
    return { synced: true, localSaved: true };
  } catch (err) {
    saveLocalItems();
    if (typeof handleCloudError === 'function') handleCloudError(err, true);
    throw err;
  }
}

async function batchDeleteItemsWithUndo(listToDelete, toastMsg = 'Удалено') {
  if (!listToDelete || !listToDelete.length) return;
  const backupCopies = listToDelete.map(x => ({ ...x }));
  const delIdStrs = new Set(listToDelete.map(x => String(x.id)));
  window._recentlyDeletedIds = window._recentlyDeletedIds || new Set();

  // 1. Отменяем любые отложенные сохранения в облако для удаляемых карточек и помечаем их удалёнными
  const docIdsToRemove = new Set();
  backupCopies.forEach(it => {
    const primaryDocId = getCloudDocId(it);
    const actualDocId = it._docId ? String(it._docId) : primaryDocId;
    docIdsToRemove.add(actualDocId);
    window._recentlyDeletedIds.add(String(it.id));
    window._recentlyDeletedIds.add(actualDocId);
    window._recentlyDeletedIds.add(primaryDocId);
    [actualDocId, primaryDocId].forEach(dId => {
      if (_cloudSaveTimers.has(dId)) {
        clearTimeout(_cloudSaveTimers.get(dId).timer);
        _cloudSaveTimers.get(dId).resolve();
        _cloudSaveTimers.delete(dId);
      }
    });
  });

  // 2. Сразу обновляем локальный список, кэш и DOM ДО сетевого ожидания; разрешаем обновление safetyBackup при штатном удалении!
  const remainingAfterDelete = items.filter(i => !delIdStrs.has(String(i.id)));
  window._explicitEmptyAllowed = (remainingAfterDelete.length === 0);
  window._userInitiatedDelete = true;
  items = remainingAfterDelete;
  flushLocalItemsNow(items.length === 0);
  profCloud(true);
  refresh();

  // 3. Удаляем документы в Firestore (или ставим в очередь pendingCloudDeletes при квоте/офлайне)
  try {
    if (user && !user.isLocal) {
      const allDelIds = [...docIdsToRemove].filter(Boolean);
      if (typeof isCloudWriteBlocked === 'function' && isCloudWriteBlocked()) {
        if (typeof addPendingDeletes === 'function') addPendingDeletes(allDelIds, user.uid);
        setSync();
      } else {
        try {
          for (let i = 0; i < allDelIds.length; i += 350) {
            const chunk = allDelIds.slice(i, i + 350);
            const b = writeBatch(db);
            chunk.forEach(dId => b.delete(doc(db, 'items', dId)));
            await track(b.commit());
          }
          if (typeof scheduleColRevBump === 'function') scheduleColRevBump();
        } catch (e) {
          if (typeof addPendingDeletes === 'function') addPendingDeletes(allDelIds, user.uid);
          if (typeof handleCloudError === 'function') handleCloudError(e, true);
        }
      }
    }
  } finally {
    setTimeout(() => { window._explicitEmptyAllowed = false; window._userInitiatedDelete = false; }, 1500);
  }

  toast(toastMsg, false, {
    label: '↩ Отменить удаление',
    fn: async () => {
      try {
        const undoIds = [];
        backupCopies.forEach(it => {
          const pId = getCloudDocId(it);
          const aId = it._docId ? String(it._docId) : pId;
          undoIds.push(aId, pId);
          window._recentlyDeletedIds.delete(String(it.id));
          window._recentlyDeletedIds.delete(pId);
          if (it._docId) window._recentlyDeletedIds.delete(String(it._docId));
          if (!items.some(x => String(x.id) === String(it.id))) items.push(fix(it));
        });
        if (user && !user.isLocal && typeof removePendingDeletes === 'function') {
          removePendingDeletes(undoIds, user.uid);
        }
        saveLocalItems();
        refresh();
        await batchSaveItems(backupCopies);
        profCloud(true);
        toast(`Восстановлено записей: ${backupCopies.length}`);
      } catch (err) {
        toast('Восстановлено локально (облако недоступно: ' + (err.code || err.message) + ')', true);
      }
    }
  });
}

// Экспорт полного бэкапа (.json) + напоминание раз в 2 недели
window.exportData = () => {
  const myOwnItems = items;
  if (!myOwnItems.length) return toast('Твоя коллекция пуста, нечего скачивать.');
  const payload = {
    version: 4,
    exportedAt: new Date().toISOString(),
    profile: {
      name: prof.name, bio: prof.bio, mood: prof.mood, realName: prof.realName, bday: prof.bday,
      cardStyle: prof.cardStyle, customColor: prof.customColor,
      showMyNotes: !!prof.showMyNotes,
      customLists: prof.customLists || [], listMeta: prof.listMeta || {},
      favChars: prof.favChars || [], equippedMedals: prof.equippedMedals || []
    },
    items: myOwnItems.map(({userId, _docId, _knownStatusFromImport, lastLinkAttempt, ...r}) => r)
  };
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'}));
  a.href = u; a.download = `Kiroku_FullBackup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(u);
  try { localStorage.setItem('lastBackup', String(Date.now())); } catch (e) {}
};

let nudged = false;
function backupNudge() {
  if (nudged || items.length < 5) return;
  nudged = true; let t = 0; try { t = +localStorage.getItem('lastBackup') || 0; } catch (e) {}
  if (Date.now() - t > 14 * 864e5) {
    toast('Напоминание: давно не сохранялась резервная копия коллекции.', false, {label: 'Скачать бэкап', fn: () => window.exportData()});
  }
}

function getSavedImportMeta() {
  try { return JSON.parse(localStorage.getItem(getUidStorageKey('lastImportMeta')) || 'null'); } catch (e) { return null; }
}
function setSavedImportMeta(meta) {
  try {
    if (!meta) localStorage.removeItem(getUidStorageKey('lastImportMeta'));
    else localStorage.setItem(getUidStorageKey('lastImportMeta'), JSON.stringify(meta));
  } catch (e) {}
  updateLastImportBatchBarUI();
}
function updateLastImportBatchBarUI() {
  const bar = $('lastImportBatchBar'), txt = $('lastImportBatchTxt'), btn = $('undoLastImportBtn');
  if (!bar || !txt || !btn) return;
  const meta = getSavedImportMeta();
  if (!meta || !meta.batchId) {
    bar.style.display = 'none';
    return;
  }
  const batchItems = items.filter(i => i.importBatchId === meta.batchId);
  if (!batchItems.length) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  txt.textContent = `Последний импорт (${meta.source || 'Файл'}): ${batchItems.length} шт. от ${new Date(meta.ts || Date.now()).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}`;
  btn.onclick = async () => {
    if (!(await uiConfirm(`Отменить последний импорт «${meta.source}»?\n\nЧто делает эта кнопка: из коллекции будут удалены только те записи (${batchItems.length} шт.), которые были добавлены в этом последнем импорте. Все остальные тайтлы останутся без изменений.`, 'Подтвердить', true))) return;
    await batchDeleteItemsWithUndo(batchItems, `Импорт «${meta.source}» отменён (${batchItems.length} шт.)`);
    setSavedImportMeta(null);
  };
}

// Единое окно предпросмотра перед ЛЮБЫМ импортом (исправлены Этап 1 п.2 и п.3:
// при replaceAll удаляются ВСЕ старые документы по их реальным docId, а локальный список и кэш обновляются ТОЛЬКО после успешной записи в облако с откатом при ошибке)
async function previewAndExecuteImport(rawCandidates, sourceName, fileFingerprint = '', replaceAll = false, profBackup = null) {
  let sameFileWarn = '';
  const prevMeta = getSavedImportMeta();
  if (fileFingerprint && prevMeta && prevMeta.fingerprint === fileFingerprint && !replaceAll) {
    sameFileWarn = '⚠ ВНИМАНИЕ: этот же файл уже загружался ранее! Все совпадения автоматически отфильтрованы.\n\n';
  }

  const basePool = replaceAll ? [] : items.map(x => ({ ...x, tags: [...(x.tags || [])], lists: [...(x.lists || [])] }));
  const colDupIndex = createFastDuplicateIndex(basePool);
  const batchDupIndex = createFastDuplicateIndex([]);
  const toAdd = [];
  const duplicates = [];
  const enrichedExisting = [];

  rawCandidates.forEach(cand => {
    if (!cand || !String(cand.title || '').trim()) return;
    const dupInCol = findDuplicateMatch(cand, basePool, colDupIndex);
    const dupInBatch = findDuplicateMatch(cand, toAdd, batchDupIndex);
    if (dupInCol) {
      // Слияние выполняется строго на копии (dupInCol из basePool) и применяется к основной коллекции только после подтверждения импорта
      const beforeJson = JSON.stringify(dupInCol);
      const merged = mergeTwoDuplicateItems(dupInCol, cand);
      Object.assign(dupInCol, merged);
      colDupIndex.add(dupInCol);
      if (JSON.stringify(dupInCol) !== beforeJson && !enrichedExisting.includes(dupInCol)) {
        enrichedExisting.push(dupInCol);
      }
      duplicates.push({ cand, existing: dupInCol });
      return;
    }
    if (dupInBatch) {
      const mergedBatch = mergeTwoDuplicateItems(dupInBatch, cand);
      Object.assign(dupInBatch, mergedBatch);
      batchDupIndex.add(dupInBatch);
      duplicates.push({ cand, existing: dupInBatch });
      return;
    }
    toAdd.push(cand);
    batchDupIndex.add(cand);
  });

  const reviewList = toAdd.filter(x => x.needsReview);
  const summaryText = `${sameFileWarn}Источник: ${sourceName}\nВсего записей в источнике: ${rawCandidates.length}\n• Будет добавлено новых: ${toAdd.length} шт.\n• Пропущено повторов: ${duplicates.length} шт.\n• Отправлено во вкладку «📥 Разобрать» (неизвестен статус или не связан ID): ${reviewList.length} шт.`;

  let overrideCategory = '';
  const confirmed = await dlgOpen(() => {
    $('dlgTitle').textContent = replaceAll ? `⚠ Импорт с ЗАМЕНОЙ коллекции (${sourceName})` : `📥 Предпросмотр импорта (${sourceName})`;
    $('dlgText').textContent = summaryText;
    const body = $('dlgBody');
    body.replaceChildren();

    const catRow = el('div', 'row');
    catRow.style.cssText = 'justify-content:space-between;background:var(--inp);padding:8px 10px;border-radius:10px;border:1px solid var(--bd);font-size:13px';
    const catLbl = el('span', null, 'Категория записей:');
    const catSel = el('select');
    catSel.style.cssText = 'padding:5px 10px;font-size:13px';
    const autoCatSample = toAdd[0]?.category || rawCandidates[0]?.category || 'Аниме';
    [
      ['', `Автоопределение (сейчас: ${autoCatSample})`],
      ['Аниме', 'Все записи → Аниме'],
      ['Фильм', 'Все записи → Фильмы'],
      ['Сериал', 'Все записи → Сериалы'],
      ['Манга', 'Все записи → Манга'],
      ['Ранобэ', 'Все записи → Ранобэ']
    ].forEach(([val, txt]) => catSel.add(new Option(txt, val)));
    catSel.value = overrideCategory;
    catRow.append(catLbl, catSel);
    body.append(catRow);

    const listWrap = el('div');
    catSel.onchange = () => {
      overrideCategory = catSel.value;
      if (overrideCategory) {
        toAdd.forEach(x => {
          x.category = overrideCategory;
          if (overrideCategory === 'Манга' && !x.subKind) x.subKind = 'Манга';
        });
      }
    };
    listWrap.style.cssText = 'max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;padding:6px;background:rgba(0,0,0,.25);border-radius:10px;border:1px solid var(--bd);font-size:12.5px';
    if (!toAdd.length && !duplicates.length) {
      listWrap.append(el('div', 'meta', 'В файле не найдено подходящих записей.'));
    } else {
      toAdd.slice(0, 60).forEach(x => {
        const r = el('div', 'row'); r.style.justifyContent = 'space-between';
        r.append(
          el('b', null, `＋ ${x.title} (${x.year || '—'}, ${catLabel(x)})`),
          el('span', x.needsReview ? 'review-badge' : 'chip', x.needsReview ? `📥 На разбор (${x.status})` : x.status)
        );
        listWrap.append(r);
      });
      if (toAdd.length > 60) listWrap.append(el('div', 'meta', `…и ещё ${toAdd.length - 60} новых записей`));
      duplicates.slice(0, 25).forEach(({ cand, existing }) => {
        const r = el('div', 'row'); r.style.justifyContent = 'space-between'; r.style.opacity = '0.65';
        r.append(
          el('span', null, `⏭ Повтор: ${cand.title} (${cand.year || '—'})`),
          el('span', 'meta', `уже есть как «${existing.title}»`)
        );
        listWrap.append(r);
      });
    }
    body.append(listWrap);
  }, replaceAll ? 'Заменить коллекцию' : `Импортировать (${toAdd.length})`, replaceAll, () => true);

  if (!confirmed) return;
  const applyEnrichedCopiesToMainCollection = () => {
    enrichedExisting.forEach(copyItem => {
      const target = items.find(x => String(x.id) === String(copyItem.id));
      if (target) Object.assign(target, copyItem);
    });
  };
  if (!toAdd.length && !replaceAll) {
    if (enrichedExisting.length) {
      applyEnrichedCopiesToMainCollection();
      await batchSaveItems(enrichedExisting);
      saveLocalItems();
      refresh();
      hideModalElement('dataModal');
      toast(`Все тайтлы уже были в коллекции — обновлены данные (избранное / альт. названия / оценки) у ${enrichedExisting.length} записей! ✨`);
      return;
    }
    toast('Новых записей для добавления нет — все тайтлы уже есть в коллекции.');
    return;
  }

  if (replaceAll && items.length) window.exportData();

  const prevItemsSnapshot = items.map(x => ({ ...x }));
  const batchId = 'imp_' + Date.now();
  const usedIds = new Set(replaceAll ? [] : items.map(i => String(i.id)));
  const finalAdd = toAdd.map(x => {
    let idVal = Number(x.id) || 0;
    while (!idVal || usedIds.has(String(idVal))) idVal = newId();
    usedIds.add(String(idVal));
    const docId = (user && user.uid ? user.uid + '_' : 'item_') + idVal;
    const cleaned = fix({
      ...x,
      id: idVal,
      _docId: docId,
      importBatchId: batchId,
      importSource: sourceName
    });
    delete cleaned._knownStatusFromImport;
    return cleaned;
  });

  // Этап 1 п.2 и п.3: Сначала выполняем облачную транзакцию (при replaceAll удаляем ВСЕ старые документы по их реальным docId, включая старые без префикса uid_), и только после успеха обновляем локальный список и кэш!
  if (user && !user.isLocal && auth.currentUser) {
    if (typeof isCloudWriteBlocked === 'function' && isCloudWriteBlocked()) {
      const saveAsLocalDirty = [...finalAdd, ...enrichedExisting];
      saveAsLocalDirty.forEach(it => { it.dirty = true; });
      if (!replaceAll) {
        if (enrichedExisting.length) applyEnrichedCopiesToMainCollection();
        items = deduplicateListByIdAndCleanupCloud([...items, ...finalAdd], false);
        saveLocalItems();
        setSavedImportMeta({ batchId, source: sourceName, count: finalAdd.length, fingerprint: fileFingerprint, ts: Date.now() });
        refresh();
        hideModalElement('dataModal');
        toast(`Импортировано локально (${finalAdd.length} шт.) — облако сейчас недоступно, записи отправятся при синхронизации.`);
        return;
      }
      toast('Массовая замена коллекции недоступна, пока исчерпан лимит Firebase или нет сети.', true);
      return;
    }
    try {
      if (replaceAll) {
        const oldDocIdsSet = new Set();
        prevItemsSnapshot.forEach(old => {
          oldDocIdsSet.add(getCloudDocId(old));
          if (old._docId) oldDocIdsSet.add(String(old._docId));
          if (old.id) {
            oldDocIdsSet.add(String(old.id));
            oldDocIdsSet.add(user.uid + '_' + String(old.id));
          }
        });
        try {
          const cloudOwnSnap = await getDocs(query(collection(db, 'items'), where('userId', '==', user.uid)));
          cloudOwnSnap.docs.forEach(d => {
            const raw = d.data();
            if (!raw.isProfile && d.id !== 'prof_' + user.uid && raw.kind !== 'wall' && raw.kind !== 'rec' && raw.kind !== 'friendReq' && raw.kind !== 'dm') {
              oldDocIdsSet.add(d.id);
            }
          });
        } catch (e) {}
        const allOldDocIds = [...oldDocIdsSet];
        for (let i = 0; i < allOldDocIds.length; i += 350) {
          const bDel = writeBatch(db);
          allOldDocIds.slice(i, i + 350).forEach(dId => bDel.delete(doc(db, 'items', dId)));
          await track(bDel.commit());
        }
      }

      const allCloudWrites = [...finalAdd, ...enrichedExisting];
      for (let i = 0; i < allCloudWrites.length; i += 350) {
        const bSet = writeBatch(db);
        allCloudWrites.slice(i, i + 350).forEach(it => {
          const { docId, payload } = prepareTitleForCloud(it, user.uid);
          bSet.set(doc(db, 'items', docId), payload);
        });
        await track(bSet.commit());
      }
      if (typeof scheduleColRevBump === 'function') scheduleColRevBump();
    } catch (cloudErr) {
      if (typeof handleCloudError === 'function') handleCloudError(cloudErr, true);
      items = prevItemsSnapshot;
      saveLocalItems();
      refresh();
      toast('Импорт отменён — ошибка записи в облако: ' + (cloudErr.code || cloudErr.message), true);
      return;
    }
  }

  if (profBackup) {
    if (profBackup.customLists) prof.customLists = [...new Set([...(prof.customLists || []), ...profBackup.customLists])];
    if (profBackup.listMeta) prof.listMeta = { ...(prof.listMeta || {}), ...profBackup.listMeta };
    if (profBackup.favChars && (!prof.favChars || !prof.favChars.length)) prof.favChars = profBackup.favChars;
    if (profBackup.equippedMedals && (!prof.equippedMedals || !prof.equippedMedals.length)) prof.equippedMedals = profBackup.equippedMedals;
    profCloud();
  }

  if (!replaceAll && enrichedExisting.length) {
    applyEnrichedCopiesToMainCollection();
  }
  if (replaceAll && !finalAdd.length) { window._explicitEmptyAllowed = true; setTimeout(() => { window._explicitEmptyAllowed = false; }, 1500); }
  items = deduplicateListByIdAndCleanupCloud(replaceAll ? finalAdd : [...items, ...finalAdd], true);
  saveLocalItems();
  setSavedImportMeta({ batchId, source: sourceName, count: finalAdd.length, fingerprint: fileFingerprint, ts: Date.now() });
  refresh();
  hideModalElement('dataModal');

  toast(`Импортировано: ${finalAdd.length} шт. (повторов пропущено: ${duplicates.length}, на разбор: ${reviewList.length})`, false, {
    label: '↩ Отменить импорт',
    fn: () => $('undoLastImportBtn')?.click()
  });

  const unlinkedNew = finalAdd.filter(i => !hasExternalCatalogId(i));
  if (unlinkedNew.length) {
    setTimeout(() => startCatalogLinkingForList(unlinkedNew, false), 900);
  }
}

// Загрузка JSON-бэкапа
window.importData = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const txt = r.result;
      const fp = await sha256Hex(txt.slice(0, 50000) + '_' + txt.length);
      const raw = JSON.parse(txt);
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : null);
      if (!arr) throw new Error('Неверный формат JSON');
      const profBackup = (!Array.isArray(raw) && raw?.profile) ? raw.profile : null;

      const candidates = arr.map(x => {
        const wasFavStatus = x.status === 'Любимое';
        const knownStatus = wasFavStatus
          ? (x.prevSt && STATS.includes(x.prevSt) ? x.prevSt : 'Просмотрено/Прочитано')
          : (STATS.includes(x.status) ? x.status : '');
        const resolvedStatus = knownStatus || 'В планах';
        const isDone = resolvedStatus === 'Просмотрено/Прочитано' || resolvedStatus === 'Пересматриваю';
        const rawComp = Number(x.completedAt) || 0;
        const compTs = isDone && rawComp > 0 ? rawComp : 0;
        const catVal = x.category === 'Кино' ? 'Фильм' : (x.category === 'Манхва' || x.category === 'Маньхуа') ? 'Манга' : CATS.includes(x.category) ? x.category : 'Фильм';
        const subK = x.category === 'Манхва' ? 'Манхва' : x.category === 'Маньхуа' ? 'Маньхуа' : (x.subKind || (MANGA_SUBKINDS.includes(x.kind) ? x.kind : (catVal === 'Манга' ? 'Манга' : '')));
        return fix({
          id: Number(x.id) || 0,
          title: String(x.title || '').trim(),
          category: catVal,
          subKind: subK,
          status: resolvedStatus,
          needsReview: Boolean(x.needsReview || !knownStatus),
          fav: !!(x.fav || wasFavStatus),
          isAdult: Boolean(x.isAdult),
          completedAt: compTs,
          rewatchCount: Number(x.rewatchCount) || 0,
          poster: x.poster || '', year: x.year || '', rating: x.rating || '',
          extRating: x.extRating || '', extSrc: x.extSrc || '', description: x.description || '',
          titleEn: x.titleEn || '', titleOrig: x.titleOrig || '',
          alt: x.alt || '', author: x.author || '', studio: x.studio || '', source: x.source || '', ongoing: !!x.ongoing,
          tags: Array.isArray(x.tags) ? x.tags : [], lists: Array.isArray(x.lists) ? x.lists : [], recBy: x.recBy || '',
          pin: !!x.pin, archived: !!x.archived, eps: +x.eps || 0, vols: +x.vols || 0,
          format: x.format || '', aniId: +x.aniId || 0, mal: +x.mal || 0, tmdb: x.tmdb || '', imdbId: x.imdbId || '',
          dur: +x.dur || 0, seasons: +x.seasons || 0, myNote: x.myNote || '', criteria: x.criteria || null
        });
      });

      await previewAndExecuteImport(candidates, 'JSON-бэкап', fp, false, profBackup);
    } catch (err) { toast('Ошибка чтения JSON файла: ' + err.message, true); }
    e.target.value = '';
  };
  r.readAsText(f);
};

// Импорт XML / JSON файлов MyAnimeList и Shikimori
window.importMalXml = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const txt = r.result;
      const fp = await sha256Hex(txt.slice(0, 50000) + '_' + txt.length);
      if (txt.trim().startsWith('[') || txt.trim().startsWith('{')) {
        const jsonArr = JSON.parse(txt);
        const ST_SH = { completed: 'Просмотрено/Прочитано', watching: 'Смотрю/Читаю', planned: 'В планах', dropped: 'Брошено', on_hold: 'В планах', rewatching: 'Пересматриваю' };
        const candidates = (Array.isArray(jsonArr) ? jsonArr : []).map(entry => {
          const title = String(entry.target_title || entry.title || '').trim();
          if (!title) return null;
          const catType = entry.target_type === 'Manga' ? 'Манга' : 'Аниме';
          const malId = Number(entry.target_id || entry.mal_id) || 0;
          const knownSt = ST_SH[entry.status] || '';
          const status = knownSt || 'В планах';
          const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';
          const compTs = isDone && entry.updated_at ? new Date(entry.updated_at).getTime() : 0;
          return fix({
            mal: malId, title, titleEn: title, category: catType, subKind: catType === 'Манга' ? 'Манга' : '',
            status,
            needsReview: Boolean(!knownSt || !malId),
            rating: entry.score ? String(entry.score) : '',
            eps: Number(entry.episodes || entry.chapters) || 0,
            vols: Number(entry.volumes) || 0,
            rewatchCount: Number(entry.rewatches) || 0,
            completedAt: compTs || 0,
            tags: []
          });
        }).filter(Boolean);
        await previewAndExecuteImport(candidates, 'Shikimori JSON', fp, false, null);
        e.target.value = '';
        return;
      }

      const xml = new DOMParser().parseFromString(txt, 'text/xml');
      const animeNodes = [...xml.querySelectorAll('anime')];
      const mangaNodes = [...xml.querySelectorAll('manga')];
      const ST_MAL = { 'Completed': 'Просмотрено/Прочитано', 'Watching': 'Смотрю/Читаю', 'Reading': 'Смотрю/Читаю', 'Plan to Watch': 'В планах', 'Plan to Read': 'В планах', 'Dropped': 'Брошено', 'On-Hold': 'В планах' };
      const gTxt = (node, tag) => node.querySelector(tag)?.textContent?.trim() || '';
      const candidates = [];

      animeNodes.forEach(n => {
        const title = gTxt(n, 'series_title');
        if (!title) return;
        const mal = Number(gTxt(n, 'series_animedb_id')) || 0;
        const knownSt = ST_MAL[gTxt(n, 'my_status')] || '';
        const st = knownSt || 'В планах';
        const isDone = st === 'Просмотрено/Прочитано' || st === 'Пересматриваю';
        const score = Number(gTxt(n, 'my_score')) || 0;
        const finDate = gTxt(n, 'my_finish_date');
        const parsedDate = (finDate && finDate !== '0000-00-00') ? new Date(finDate).getTime() : 0;
        const compTs = (isDone && parsedDate && !isNaN(parsedDate)) ? parsedDate : 0;
        candidates.push(fix({
          mal, title, titleEn: title, category: 'Аниме', status: st,
          needsReview: Boolean(!knownSt || !mal),
          rating: score > 0 ? String(score) : '',
          eps: Number(gTxt(n, 'series_episodes')) || Number(gTxt(n, 'my_watched_episodes')) || 0,
          dur: 24, rewatchCount: Number(gTxt(n, 'my_times_watched')) || 0,
          completedAt: compTs, tags: []
        }));
      });

      mangaNodes.forEach(n => {
        const title = gTxt(n, 'manga_title');
        if (!title) return;
        const mal = Number(gTxt(n, 'manga_mangadb_id')) || 0;
        const knownSt = ST_MAL[gTxt(n, 'my_status')] || '';
        const st = knownSt || 'В планах';
        const isDone = st === 'Просмотрено/Прочитано' || st === 'Пересматриваю';
        const score = Number(gTxt(n, 'my_score')) || 0;
        const finDate = gTxt(n, 'my_finish_date');
        const parsedDate = (finDate && finDate !== '0000-00-00') ? new Date(finDate).getTime() : 0;
        const compTs = (isDone && parsedDate && !isNaN(parsedDate)) ? parsedDate : 0;
        candidates.push(fix({
          mal, title, titleEn: title, category: 'Манга', subKind: 'Манга', status: st,
          needsReview: Boolean(!knownSt || !mal),
          rating: score > 0 ? String(score) : '',
          eps: Number(gTxt(n, 'manga_chapters')) || Number(gTxt(n, 'my_read_chapters')) || 0,
          vols: Number(gTxt(n, 'manga_volumes')) || Number(gTxt(n, 'my_read_volumes')) || 0,
          completedAt: compTs, tags: []
        }));
      });

      await previewAndExecuteImport(candidates, 'MAL XML', fp, false, null);
    } catch (err) { toast('Не удалось разобрать XML/JSON файл: ' + err.message, true); }
    e.target.value = '';
  };
  r.readAsText(f);
};

// ИМПОРТ ФАЙЛОВ КИНОПОИСКА (ИСПРАВЛЕНЫ ВСЕ РЕГУЛЯРКИ БЕЗ ДВОЙНЫХ СЛЭШЕЙ + САМОПРОВЕРКА ПАРСЕРОВ — Этап 1 п.1)
function splitCsvRow(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === sep && !inQ) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseKinopoiskDate(str) {
  if (!str) return 0;
  const s = String(str).trim();
  const mRu = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (mRu) {
    const ts = new Date(Number(mRu[3]), Number(mRu[2]) - 1, Number(mRu[1]), 12, 0, 0).getTime();
    return isNaN(ts) ? 0 : ts;
  }
  const ts = new Date(s).getTime();
  return isNaN(ts) ? 0 : ts;
}

function normalizeAnixartBatchRatings(candidates) {
  const rated = (candidates || []).map(c => parseFloat(c.rating) || 0).filter(v => v > 0);
  if (rated.length > 0 && rated.every(v => v >= 1 && v <= 5)) {
    candidates.forEach(c => {
      const r = parseFloat(c.rating) || 0;
      if (r >= 1 && r <= 5) c.rating = String(+(r * 2).toFixed(1).replace(/\.0$/, ''));
      const ex = parseFloat(c.extRating) || 0;
      if (ex > 0 && ex <= 5) c.extRating = (ex * 2).toFixed(1);
    });
  }
  return candidates;
}

function buildKinopoiskCandidateFromRecord(rec, defaultCat = 'Фильм', isFiveStarScale = false) {
  let titleRu = String(rec.titleRu || rec.ru || rec.nameRu || rec.title || '').trim();
  let titleOrig = String(rec.titleOrig || rec.orig || rec.nameEn || rec.originalTitle || '').trim();
  let year = String(rec.year || '').trim();
  const yrInTitle = titleRu.match(/\((?:[^)]*?(\b(?:19|20)\d{2}\b)[^)]*)\)$/);
  const typeAndCatStr = String(rec.type || '') + ' ' + String(rec.category || '') + ' ' + String(rec.genre || '');
  const isRanobeHint = /ранобэ|light novel|новелл/i.test(typeAndCatStr);
  const isMangaHint = /манга|манхва|маньхуа|manga|manhwa|manhua|комикс/i.test(typeAndCatStr);
  const isAnimeHint = defaultCat === 'Аниме' || /(?:аниме|anime|anixart|shikimori|озвучка|серий|эпизод|\b(?:mal|ova|ona)\b|тв-\d)/i.test(typeAndCatStr + ' ' + String(rec.status || ''));
  const isSeriesHint = /сериал|мини-сериал|season|сезон/i.test(titleRu + ' ' + typeAndCatStr);
  if (yrInTitle && !year) year = yrInTitle[1];
  // Убираем в конце только чистый год (2014) или общую пометку (сериал)/(фильм) без номера сезона/части, чтобы НЕ терять (ТВ-2), (Фильм 1), (OVA) и т.д.
  titleRu = titleRu.replace(/\s*\((?:(?:мини-)?сериал|фильм|\d{4})\)\s*$/i, '').trim();
  if (!titleRu && titleOrig) titleRu = titleOrig;
  if (!titleRu) return null;

  let rawRateNum = parseFloat(String(rec.rating || rec.myRating || rec.vote || '').replace(',', '.')) || 0;
  // В Anixart оценки выставляются по 5-звёздочной шкале (1–5) — конвертируем в 10-балльную (2–10)
  if (rawRateNum > 10 && rawRateNum <= 100) rawRateNum = +(rawRateNum / 10).toFixed(1);
  else if (isFiveStarScale && rawRateNum >= 1 && rawRateNum <= 5) rawRateNum = +(rawRateNum * 2).toFixed(1).replace(/\.0$/, '');
  const myRating = (rawRateNum >= 1 && rawRateNum <= 10) ? String(rawRateNum) : '';
  let extNum = parseFloat(String(rec.kpRating || rec.imdbRating || rec.extRating || '').replace(',', '.')) || 0;
  if (isFiveStarScale && extNum > 0 && extNum <= 5) extNum = +(extNum * 2);
  const extRating = (extNum > 0 && extNum <= 10) ? extNum.toFixed(1) : '';
  const imdbMatch = String(rec.imdb || rec.imdbId || rec.url || '').match(/tt\d{5,10}/i);
  const imdbId = imdbMatch ? imdbMatch[0].toLowerCase() : '';
  const dateTs = parseKinopoiskDate(rec.date || rec.completedAt || '');

  const rawSt = String(rec.status || rec.folder || rec.list || '').trim().toLowerCase();
  const rawFav = String(rec.fav || rec.favorite || rec.isFavorite || '').trim().toLowerCase();
  // ИСПРАВЛЕНИЕ БАГА №3: учитываем «Добавлено» (CSV Anixart) и «В избранном» (TXT Anixart), исключая «Не добавлено» / «Не в избранном»
  let isFav = /^(да|yes|true|1|\+|★|❤|добавлено|в избранном|избранное|любимое)$/i.test(rawFav)
    || ((/добавлен|в избранн|избранн|любим/i.test(rawFav)) && !/не\s+в|не\s+добав|^нет$|^no$|^false$|^0$/i.test(rawFav))
    || /любим|избран|fav/i.test(rawSt);

  let status = '';
  if (rawSt === '1' || /смотрю|читаю|watching|reading|current/i.test(rawSt)) status = 'Смотрю/Читаю';
  else if (rawSt === '2' || /план|буду|запланир|отложен|пауз|hold|paused|watchlist|plan/i.test(rawSt)) status = 'В планах';
  else if (rawSt === '3' || /просмотр|прочит|заверш|watched|completed|оценен/i.test(rawSt)) status = 'Просмотрено/Прочитано';
  else if (rawSt === '4') status = 'В планах';
  else if (rawSt === '5' || /брош|dropped/i.test(rawSt)) status = 'Брошено';
  else if (/пересматр|rewatch|repeat/i.test(rawSt)) status = 'Пересматриваю';
  else if (isFav || myRating) status = 'Просмотрено/Прочитано';

  const knownSt = Boolean(status);
  if (!status) status = defaultCat === 'Аниме' ? 'В планах' : 'Просмотрено/Прочитано';
  const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';

  const cat = isRanobeHint ? 'Ранобэ' : isMangaHint ? 'Манга' : isAnimeHint ? 'Аниме' : isSeriesHint ? 'Сериал' : defaultCat;
  const epsVal = parseInt(rec.eps || rec.episodes || rec.watchedEpisodes || '') || 0;
  const altClean = String(rec.alt || rec.altTitles || '').trim();
  return fix({
    title: titleRu,
    titleEn: titleOrig,
    titleOrig,
    alt: altClean,
    year: year.slice(0, 4),
    category: cat,
    status,
    fav: isFav,
    needsReview: Boolean(!knownSt && !imdbId),
    _knownStatusFromImport: knownSt,
    rating: myRating,
    extRating,
    extSrc: extRating ? (cat === 'Аниме' ? 'Anixart' : 'Кинопоиск') : '',
    imdbId,
    eps: epsVal,
    completedAt: isDone && dateTs > 0 ? dateTs : 0,
    dur: parseInt(rec.dur || rec.runtime) || (cat === 'Аниме' ? 24 : 0),
    myNote: String(rec.comment || rec.note || '').trim(),
    tags: rec.genre ? parseTags(String(rec.genre)) : []
  });
}

function parseKinopoiskContent(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  // 1. JSON формат
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.items || j.movies || j.data || []);
      return arr.map(x => buildKinopoiskCandidateFromRecord({
        titleRu: x.nameRu || x.titleRu || x.russian || x.title || x.name,
        titleOrig: x.nameEn || x.nameOriginal || x.titleOrig || x.originalTitle || '',
        year: x.year || x.releaseYear || '',
        rating: x.userRate || x.myRating || x.rating || x.vote || '',
        kpRating: x.ratingKinopoisk || x.kpRating || x.extRating || '',
        imdbId: x.imdbId || x.imdb_id || '',
        type: x.type || x.category || '',
        date: x.date || x.votedAt || x.completedAt || '',
        dur: x.filmLength || x.dur || '',
        genre: Array.isArray(x.genres) ? x.genres.map(g => g.genre || g).join(', ') : (x.genre || ''),
        status: x.status || (x.userRate ? 'просмотрено' : '')
      })).filter(Boolean);
    } catch (e) {}
  }

  // 2. HTML / XLS-таблица экспорта Кинопоиска
  if (/<table|<tr|<td/i.test(trimmed)) {
    const docDom = new DOMParser().parseFromString(trimmed, 'text/html');
    const rows = [...docDom.querySelectorAll('tr')];
    if (rows.length > 1) {
      const headers = [...rows[0].querySelectorAll('th,td')].map(c => c.textContent.trim().toLowerCase());
      const findCol = re => headers.findIndex(h => re.test(h));
      const cRu = findCol(/русскоязычн|название|фильм|title|name/i);
      const cOrig = findCol(/оригинальн|original|eng/i);
      const cYear = findCol(/год|year/i);
      const cRate = findCol(/моя оценка|оценка|rating|vote|балл/i);
      const cDate = findCol(/дата|date|voted/i);
      const cImdb = findCol(/imdb/i);
      const cKpRate = findCol(/кинопоиск|kp|рейтинг/i);
      const cGenre = findCol(/жанр|genre/i);
      const cDur = findCol(/мин|длительн|runtime|хронометраж/i);

      const out = [];
      for (let rIdx = 1; rIdx < rows.length; rIdx++) {
        const cells = [...rows[rIdx].querySelectorAll('td')].map(c => c.textContent.trim());
        if (cells.length < 2) continue;
        const rec = {
          titleRu: cRu >= 0 ? cells[cRu] : cells[1] || cells[0],
          titleOrig: cOrig >= 0 ? cells[cOrig] : (cells[2] || ''),
          year: cYear >= 0 ? cells[cYear] : '',
          rating: cRate >= 0 ? cells[cRate] : '',
          date: cDate >= 0 ? cells[cDate] : '',
          imdbId: cImdb >= 0 ? cells[cImdb] : rows[rIdx].innerHTML,
          kpRating: (cKpRate >= 0 && cKpRate !== cRate) ? cells[cKpRate] : '',
          genre: cGenre >= 0 ? cells[cGenre] : '',
          dur: cDur >= 0 ? cells[cDur] : ''
        };
        const cand = buildKinopoiskCandidateFromRecord(rec);
        if (cand) out.push(cand);
      }
      if (out.length) return out;
    }
  }

  // 3. CSV / TSV или построчный список с поддержкой многострочных кавычек внутри ячеек CSV
  const splitCsvLogicalLines = raw => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        cur += ch;
        if (inQ && raw[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if ((ch === '\n' || ch === '\r') && !inQ) {
        if (ch === '\r' && raw[i + 1] === '\n') i++;
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else if ((ch === '\n' || ch === '\r') && inQ) {
        if (ch === '\r' && raw[i + 1] === '\n') i++;
        cur += ' ';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const lines = splitCsvLogicalLines(trimmed);
  if (!lines.length) return [];
  const first = lines[0];

  // ИСПРАВЛЕНИЕ БАГА №4: Распознавание формата .txt из Anixart, где поля разделены через « / » (напр. 1 / "История финала 2" / ... / Смотрю)
  const splitAnixartSlashRow = line => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === '/' && !inQ && (i > 0 && /\s/.test(line[i - 1])) && (i + 1 < line.length && /\s/.test(line[i + 1]))) {
        out.push(cur.trim().replace(/^"|"$/g, '').trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim().replace(/^"|"$/g, '').trim());
    return out;
  };

  const isAnixartSlashTxt = lines.slice(0, Math.min(10, lines.length)).some(l => splitAnixartSlashRow(l).length >= 4 && (/^\d+\s+\/\s+/.test(l) || /смотрю|в планах|просмотрено|отложено|брошено|в избранном|название/i.test(l)));
  if (isAnixartSlashTxt) {
    const firstCols = splitAnixartSlashRow(first).map(h => h.replace(/^[\uFEFF"'\s]+|["'\s]+$/g, '').toLowerCase());
    const hasTxtHeader = firstCols.some(h => /название|оригинал|альтернатив|статус|список|избранн|оценка/i.test(h));
    const findTxtCol = (re, ex = null) => firstCols.findIndex(h => re.test(h) && (!ex || !ex.test(h)));
    const tRu = findTxtCol(/русскоязычн|русское|^название$|^наименование$|название релиз|title_ru|^title$/i, /оригин|альтерн/i);
    const tOrig = findTxtCol(/оригинальн|original|romaji|title_orig/i, /альтерн/i);
    const tAlt = findTxtCol(/альтернативн|другие назван|синоним|alt/i);
    const tStatus = findTxtCol(/статус|список|закладк|папка|status|list/i);
    const tFav = findTxtCol(/избранн|любим|favorite|fav/i);
    const tRate = findTxtCol(/оценка|балл|рейтинг|score|rating|vote/i);

    const outTxt = [];
    for (let i = hasTxtHeader ? 1 : 0; i < lines.length; i++) {
      const rawCols = splitAnixartSlashRow(lines[i]);
      if (rawCols.length < 2) continue;
      if (hasTxtHeader) {
        const cand = buildKinopoiskCandidateFromRecord({
          titleRu: tRu >= 0 ? rawCols[tRu] : (rawCols[1] || rawCols[0]),
          titleOrig: tOrig >= 0 ? rawCols[tOrig] : (rawCols[2] || ''),
          alt: tAlt >= 0 ? rawCols[tAlt] : (rawCols[3] || ''),
          status: tStatus >= 0 ? rawCols[tStatus] : (rawCols[4] || ''),
          fav: tFav >= 0 ? rawCols[tFav] : (rawCols[5] || ''),
          rating: tRate >= 0 ? rawCols[tRate] : (rawCols[6] || '')
        }, 'Аниме');
        if (cand) outTxt.push(cand);
      } else {
        // Формат без заголовка: 1 / "Русское название" / "Оригинальное" / "Альтернативные" / Смотрю / В избранном / 10
        const cols = /^\d+$/.test(rawCols[0]) ? rawCols.slice(1) : rawCols;
        if (!cols.length) continue;
        const isStToken = s => /^(смотрю|в планах|просмотрено|отложено|брошено|запланировано|пересматриваю|watching|planned|completed|on hold|dropped)$/i.test(String(s || '').trim());
        const isFavToken = s => /^(в избранном|не в избранном|добавлено|не добавлено|избранное|любимое)$/i.test(String(s || '').trim());
        const isRateToken = s => /^(?:[1-9]|10)(?:[.,]\d)?$/.test(String(s || '').trim()) || /^оценка\s*[:\-]?\s*\d/i.test(String(s || '').trim());

        let titleRu = cols[0] || '';
        let titleOrig = '', alt = '', status = '', fav = '', rating = '';
        for (let k = 1; k < cols.length; k++) {
          const val = String(cols[k] || '').trim();
          if (!val || val === '-' || val === '—') continue;
          if (!status && isStToken(val)) { status = val; continue; }
          if (!fav && isFavToken(val)) { fav = val; continue; }
          if (!rating && isRateToken(val)) { rating = val.replace(/[^0-9.,]/g, ''); continue; }
          if (!titleOrig && k === 1) titleOrig = val;
          else if (!alt && k === 2) alt = val;
          else if (!status && /смотрю|план|просмотр|отлож|брош/i.test(val)) status = val;
          else if (!fav && /избранн|добавлен|любим/i.test(val)) fav = val;
        }
        const cand = buildKinopoiskCandidateFromRecord({ titleRu, titleOrig, alt, status, fav, rating }, 'Аниме');
        if (cand) outTxt.push(cand);
      }
    }
    if (outTxt.length) return normalizeAnixartBatchRatings(outTxt);
  }

  const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : first.includes(',') ? ',' : '';

  if (sep && lines.length > 1) {
    const hdr = splitCsvRow(first, sep).map(h => h.replace(/^[\uFEFF"'\s]+|["'\s]+$/g, '').toLowerCase());
    const hasHeader = hdr.some(h => /название|title|name|фильм|аниме|релиз|тайтл|год|year|оценка|rating|score|статус|status|список|закладк|imdb/i.test(h));
    const findCol = (re, excludeRe = null) => hdr.findIndex(h => re.test(h) && (!excludeRe || !excludeRe.test(h)));
    // Ищем русское/основное название, исключая колонки «оригинальное/альтернативное/английское название»
    let cRu = findCol(/русскоязычн|русское|^название$|^наименование$|название релиз|название аниме|фильм|^ru$|title_ru|name_ru|^title$|^name$|^аниме$|^тайтл$|^релиз$/i, /оригин|альтерн|англ|orig|romaji|en_/i);
    if (cRu < 0) cRu = findCol(/название|title|name/i, /оригин|альтерн|англ|orig|romaji/i);
    // ИСПРАВЛЕНИЕ БАГА №3: Разделяем колонку «Оригинальное название» (cOrig) и «Альтернативные названия» (cAlt)!
    const cOrig = findCol(/оригинальн|английск|original|romaji|eng|title_en|title_orig|name_orig/i, /альтернативн|alt/i);
    const cAlt = findCol(/альтернативн|другие назван|синоним|alt|synonyms/i);
    const cYear = findCol(/^год|год выход|year|released|aired/i);
    const cRate = findCol(/моя оценка|^оценка$|оценка пользовател|my_rating|user_rate|user_rating|^rating$|^score$|^vote$|балл/i);
    const cDate = findCol(/дата|date|updated|completed/i);
    const cImdb = findCol(/imdb/i);
    const cType = findCol(/^тип$|^вид$|категор|формат|type|kind|category|media_type/i);
    const cStatus = findCol(/статус|список|закладк|папка|status|list|bookmark|folder/i);
    const cFav = findCol(/избранн|любим|favorite|is_fav|^fav$/i);
    const cEps = findCol(/серий|серии|эпизод|глав|просмотрено|episodes|watched|eps|chapters|progress/i);
    const cNote = findCol(/заметк|комментар|отзыв|note|comment/i);
    const cGenre = findCol(/жанр|тег|genre|tag/i);

    // Определяем, является ли CSV выгрузкой Anixart / аниме-списка
    const sampleText = lines.slice(0, Math.min(25, lines.length)).join(' ');
    const isAnixartOrAnimeCsv = (cEps >= 0 || cFav >= 0 || cAlt >= 0 || /anixart|аниме|anime|просмотрено серий|в планах|брошено|отложено|в избранном|добавлено|онгоинг|ova|ona|тв-1|тв-2|манга|ранобэ/i.test(sampleText)) && !/tt\d{6,}/i.test(sampleText);
    const defaultCsvCat = isAnixartOrAnimeCsv ? 'Аниме' : 'Фильм';

    const out = [];
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const cols = splitCsvRow(lines[i], sep);
      if (!cols.length || cols.every(c => !c)) continue;
      const rec = hasHeader ? {
        titleRu: (cRu >= 0 && cols[cRu]) ? cols[cRu] : (cOrig >= 0 && cols[cOrig] ? cols[cOrig] : cols[0]),
        titleOrig: (cOrig >= 0 && cOrig !== cRu) ? (cols[cOrig] || '') : '',
        alt: (cAlt >= 0 && cAlt !== cRu && cAlt !== cOrig) ? (cols[cAlt] || '') : '',
        year: cYear >= 0 ? (cols[cYear] || '') : '',
        rating: cRate >= 0 ? (cols[cRate] || '') : '',
        date: cDate >= 0 ? (cols[cDate] || '') : '',
        imdbId: cImdb >= 0 ? (cols[cImdb] || '') : lines[i],
        type: cType >= 0 ? (cols[cType] || '') : '',
        status: cStatus >= 0 ? (cols[cStatus] || '') : '',
        fav: cFav >= 0 ? (cols[cFav] || '') : '',
        eps: cEps >= 0 ? (cols[cEps] || '') : '',
        note: cNote >= 0 ? (cols[cNote] || '') : '',
        genre: cGenre >= 0 ? (cols[cGenre] || '') : ''
      } : {
        titleRu: cols[0] || '',
        titleOrig: cols[1] || '',
        year: cols[2] || '',
        rating: cols[3] || '',
        date: cols[4] || '',
        imdbId: lines[i]
      };
      const cand = buildKinopoiskCandidateFromRecord(rec, defaultCsvCat);
      if (cand) out.push(cand);
    }
    if (out.length) return isAnixartOrAnimeCsv ? normalizeAnixartBatchRatings(out) : out;
  }

  // 4. Простой текстовый список (по одной записи на строке: «Название (2014) - 9»)
  return lines.map(line => {
    const m = line.match(/^(.*?)\s*(?:\((\d{4})\))?\s*(?:[-—:]\s*(\d{1,2}(?:[.,]\d)?))?$/);
    if (!m) return null;
    return buildKinopoiskCandidateFromRecord({ titleRu: m[1], year: m[2] || '', rating: m[3] || '' });
  }).filter(Boolean);
}

// Внутренняя самопроверка парсеров на примерах (CSV, TSV, HTML-таблица, JSON, текстовый список, дата, imdb-id — Этап 1 п.1)
function runParserSelfTests() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

  // 1. Дата ДД.ММ.ГГГГ
  const ts = parseKinopoiskDate('15.11.2023');
  check('Дата ДД.ММ.ГГГГ', ts > 0 && new Date(ts).getFullYear() === 2023, `ts=${ts}`);

  // 2. CSV + год в скобках + imdb-id
  const csvSample = 'Название;Оригинал;Год;Моя оценка;Дата;IMDb\nИнтерстеллар (2014);Interstellar;2014;10;15.11.2023;tt0816692\nДжентльмены (фильм);The Gentlemen;2019;9;10.02.2022;tt8367814';
  const csvRes = parseKinopoiskContent(csvSample);
  check('CSV + очистка скобок + IMDb-id', csvRes.length === 2 && csvRes[0].title === 'Интерстеллар' && csvRes[0].year === '2014' && csvRes[0].imdbId === 'tt0816692' && csvRes[0].completedAt > 0, `len=${csvRes.length}`);

  // 3. TSV с табуляцией + «(сериал)»
  const tsvSample = 'Название\tОригинал\tГод\tМоя оценка\tДата\tIMDb\nВо все тяжкие (сериал)\tBreaking Bad\t2008\t9.5\t01.05.2022\ttt0903747';
  const tsvRes = parseKinopoiskContent(tsvSample);
  check('TSV (табуляция) + (сериал)', tsvRes.length === 1 && tsvRes[0].title === 'Во все тяжкие' && tsvRes[0].category === 'Сериал' && tsvRes[0].imdbId === 'tt0903747', `title=${tsvRes[0]?.title}`);

  // 4. HTML-таблица (.xls выгрузка Кинопоиска)
  const htmlSample = '<table><tr><th>Русскоязычное название</th><th>Оригинальное название</th><th>Год</th><th>Моя оценка</th><th>Дата</th><th>IMDb</th></tr><tr><td>Начало (2010)</td><td>Inception</td><td>2010</td><td>9</td><td>20.08.2021</td><td>https://www.imdb.com/title/tt1375666/</td></tr></table>';
  const htmlRes = parseKinopoiskContent(htmlSample);
  check('HTML-таблица Кинопоиска', htmlRes.length === 1 && htmlRes[0].title === 'Начало' && htmlRes[0].imdbId === 'tt1375666' && htmlRes[0].completedAt > 0, `imdb=${htmlRes[0]?.imdbId}`);

  // 5. JSON выгрузка
  const jsonSample = JSON.stringify([{ nameRu: 'Матрица (1999)', nameEn: 'The Matrix', userRate: 10, date: '12.04.2020', imdbId: 'tt0133093' }]);
  const jsonRes = parseKinopoiskContent(jsonSample);
  check('JSON выгрузка', jsonRes.length === 1 && jsonRes[0].title === 'Матрица' && jsonRes[0].year === '1999' && jsonRes[0].imdbId === 'tt0133093', `year=${jsonRes[0]?.year}`);

  // 6. Простой текстовый список «Название (2014) - 9»
  const txtSample = 'Дюна (2021) - 8.5\nБегущий по лезвию 2049 (2017) - 9';
  const txtRes = parseKinopoiskContent(txtSample);
  check('Текстовый список «Название (2014) - 9»', txtRes.length === 2 && txtRes[0].title === 'Дюна' && txtRes[0].year === '2021' && txtRes[0].rating === '8.5', `len=${txtRes.length}`);

  window._parserSelfTestResults = results;
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error('Parser self-test failed:', failed);
  }
  return results;
}
try { runParserSelfTests(); } catch (e) {}


if ($('universalImportBtn')) {
  $('universalImportBtn').onclick = () => {
    if ($('universalImportFile')) {
      $('universalImportFile').value = '';
      $('universalImportFile').click();
    }
  };
}

window.handleUniversalFileImport = e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const fName = (f.name || '').toLowerCase();

  // 1. Если это XML-файл (MAL / Shikimori)
  if (fName.endsWith('.xml')) {
    window.importMalXml(e);
    return;
  }

  const readWithEncoding = enc => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsText(f, enc);
  });

  (async () => {
    try {
      let txt = await readWithEncoding('UTF-8');
      if ((txt.match(/\uFFFD/g) || []).length > 3) {
        txt = await readWithEncoding('windows-1251');
      }
      const trimmed = (txt || '').trim();
      if (!trimmed) {
        toast('Выбранный файл пуст', true);
        e.target.value = '';
        return;
      }
      const fp = await sha256Hex(trimmed.slice(0, 50000) + '_' + trimmed.length);

      // 2. Проверяем XML внутри любого файла
      if (trimmed.startsWith('<?xml') || /<myanimelist|<anime>/i.test(trimmed.slice(0, 400))) {
        window.importMalXml(e);
        return;
      }

      // 3. Проверяем JSON (полный бэкап MediaTracker, выгрузка Shikimori или JSON из Anixart)
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed?.bookmarks) ? parsed.bookmarks : (Array.isArray(parsed?.releases) ? parsed.releases : null)));
          if (arr && arr.length) {
            // Если это наш собственный бэкап MediaTracker
            if (parsed?.version || (arr[0] && ('extSrc' in arr[0] || 'category' in arr[0] || 'titleEn' in arr[0]))) {
              window.importData(e);
              return;
            }
            // Если это Shikimori JSON (target_title / target_id)
            if (arr[0] && ('target_title' in arr[0] || 'target_id' in arr[0])) {
              window.importMalXml(e);
              return;
            }
            // Если это JSON выгрузка Anixart или табличный JSON
            const isAnixJson = /anix/i.test(fName) || arr.some(x => x && ('title_ru' in x || 'title_original' in x || 'profile_list_status' in x || 'episodes_released' in x));
            const jsonCandidates = arr.map(x => buildKinopoiskCandidateFromRecord({
              titleRu: x.title_ru || x.nameRu || x.titleRu || x.russian || x.title || x.name || '',
              titleOrig: x.title_original || x.nameEn || x.nameOriginal || x.titleOrig || x.originalTitle || '',
              year: x.year || x.releaseYear || '',
              rating: x.my_vote || x.vote || x.userRate || x.myRating || x.rating || x.score || '',
              kpRating: x.grade || x.ratingKinopoisk || x.kpRating || x.extRating || '',
              imdbId: x.imdbId || x.imdb_id || '',
              type: x.type || x.category?.name || x.category || '',
              status: x.profile_list_status || x.status_name || x.list || x.bookmark || x.status || '',
              fav: x.is_favorite || x.favorite || x.fav || '',
              eps: x.watched_episodes || x.episodes_released || x.episodes || x.eps || '',
              date: x.date || x.votedAt || x.completedAt || '',
              dur: x.duration || x.filmLength || x.dur || '',
              genre: Array.isArray(x.genres) ? x.genres.map(g => g.genre || g.name || g).join(', ') : (x.genres || x.genre || ''),
              note: x.note || x.comment || ''
            }, isAnixJson ? 'Аниме' : 'Фильм')).filter(Boolean);
            if (jsonCandidates.length) {
              if (isAnixJson) normalizeAnixartBatchRatings(jsonCandidates);
              await previewAndExecuteImport(jsonCandidates, isAnixJson ? 'Anixart JSON' : 'JSON файл', fp, false, null);
              e.target.value = '';
              return;
            }
          }
        } catch (jsonErr) {}
      }

      // 4. CSV / TSV / Таблица Anixart / Google Таблицы / Кинопоиск / Текстовый список
      const candidates = parseKinopoiskContent(trimmed);
      if (candidates.length) {
        const isAnixFile = /anix|anime|аниме|shiki|закладк/i.test(fName) || candidates.some(c => c.category === 'Аниме');
        if (/anix|anime|аниме/i.test(fName)) {
          candidates.forEach(c => { if (c.category === 'Фильм') c.category = 'Аниме'; });
          normalizeAnixartBatchRatings(candidates);
        }
        const srcLabel = isAnixFile ? `Таблица Anixart / CSV (${f.name})` : `Таблица / Список (${f.name})`;
        await previewAndExecuteImport(candidates, srcLabel, fp, false, null);
      } else {
        toast('Не удалось распознать записи в файле. Проверь, что это CSV, JSON, XML или текстовый список.', true);
      }
    } catch (err) {
      toast('Ошибка чтения файла: ' + err.message, true);
    }
    e.target.value = '';
  })();
};

window.importKinopoiskFile = e => {
  const f = e.target.files[0]; if (!f) return;
  const readWithEncoding = enc => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsText(f, enc);
  });
  (async () => {
    try {
      let txt = await readWithEncoding('UTF-8');
      if ((txt.match(/\uFFFD/g) || []).length > 3) {
        txt = await readWithEncoding('windows-1251');
      }
      const fp = await sha256Hex(txt.slice(0, 50000) + '_' + txt.length);
      const candidates = parseKinopoiskContent(txt);
      if (!candidates.length) {
        toast('Не удалось распознать записи в файле Кинопоиска. Поддерживаются CSV, XLS/HTML таблицы, JSON и текстовые списки.', true);
        e.target.value = '';
        return;
      }
      await previewAndExecuteImport(candidates, 'Кинопоиск', fp, false, null);
    } catch (err) {
      toast('Ошибка чтения файла Кинопоиска: ' + err.message, true);
    }
    e.target.value = '';
  })();
};

// ---------- КНОПКА «🧹 Найти и объединить повторы» (с откатом при ошибке облака — Этап 1 п.1 и п.3) ----------
function itemCompletenessScore(it) {
  let s = 0;
  if (it.aniId || it.mal || it.tmdb) s += 50;
  if (num(it.rating) > 0) s += 30;
  if (it.status && it.status !== 'В планах') s += 20;
  if (it.completedAt) s += 15;
  if (it.myNote) s += 15;
  if (it.poster && !it.poster.startsWith('data:')) s += 10;
  if (it.description) s += 8;
  if ((it.tags || []).length) s += 5;
  if ((it.lists || []).length) s += 5;
  if (num(it.eps) > 0 || num(it.dur) > 0) s += 5;
  return s;
}

function mergeTwoDuplicateItems(best, other) {
  const merged = { ...best };
  if (!num(merged.rating) && num(other.rating)) merged.rating = other.rating;
  if (!merged.criteria && other.criteria) merged.criteria = other.criteria;
  if (merged.status === 'В планах' && other.status && other.status !== 'В планах') merged.status = other.status;
  if (!merged.completedAt && other.completedAt) merged.completedAt = other.completedAt;
  merged.fav = Boolean(merged.fav || other.fav);
  merged.pin = Boolean(merged.pin || other.pin);
  merged.rewatchCount = Math.max(num(merged.rewatchCount), num(other.rewatchCount));

  if (other.myNote && !merged.myNote) merged.myNote = other.myNote;
  else if (other.myNote && merged.myNote && !merged.myNote.includes(other.myNote)) {
    merged.myNote = merged.myNote + '\n' + other.myNote;
  }

  merged.lists = [...new Set([...(merged.lists || []), ...(other.lists || [])])];
  merged.tags = [...new Set([...(merged.tags || []), ...(other.tags || [])])];

  const allFallbacks = [];
  const pushFb = u => {
    if (isValidPosterUrl(u) && !allFallbacks.includes(String(u).trim())) allFallbacks.push(String(u).trim());
  };
  pushFb(merged.poster);
  (merged.posterFallbacks || []).forEach(pushFb);
  pushFb(other.poster);
  (other.posterFallbacks || []).forEach(pushFb);
  if (allFallbacks.length) {
    if (!isValidPosterUrl(merged.poster)) merged.poster = allFallbacks[0];
    merged.posterFallbacks = allFallbacks.slice(0, 6);
  }

  ['aniId', 'mal', 'shikiId', 'mdId', 'tmdb', 'imdbId', 'poster', 'titleEn', 'titleOrig', 'alt', 'year', 'extRating', 'extSrc', 'description', 'author', 'studio', 'cast', 'source', 'eps', 'vols', 'dur', 'format', 'subKind', 'recBy', 'trailerId'].forEach(k => {
    if (!merged[k] && other[k]) merged[k] = other[k];
  });
  merged.needsReview = Boolean(!hasExternalCatalogId(merged) && merged.needsReview && other.needsReview);
  delete merged._knownStatusFromImport;
  return fix(merged);
}

async function findAndMergeDuplicatesModal() {
  hideModalElement('dataModal');
  const visited = new Set();
  const groups = [];

  const buckets = new Map();
  const pushToBucket = (key, it) => {
    if (!key) return;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(it);
  };
  items.forEach(it => {
    if (!it) return;
    if (it.tmdb) pushToBucket('tmdb:' + it.tmdb, it);
    if (it.imdbId) pushToBucket('imdb:' + it.imdbId, it);
    if (Number(it.aniId) > 0) pushToBucket('ani:' + it.aniId, it);
    if (Number(it.mal) > 0) pushToBucket('mal:' + it.mal, it);
    getCachedItemNormMeta(it).primary.forEach(nt => pushToBucket('t:' + nt, it));
  });

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a || visited.has(a.id)) continue;
    const candidatePeers = new Set();
    if (a.tmdb) (buckets.get('tmdb:' + a.tmdb) || []).forEach(x => candidatePeers.add(x));
    if (a.imdbId) (buckets.get('imdb:' + a.imdbId) || []).forEach(x => candidatePeers.add(x));
    if (Number(a.aniId) > 0) (buckets.get('ani:' + a.aniId) || []).forEach(x => candidatePeers.add(x));
    if (Number(a.mal) > 0) (buckets.get('mal:' + a.mal) || []).forEach(x => candidatePeers.add(x));
    getCachedItemNormMeta(a).primary.forEach(nt => (buckets.get('t:' + nt) || []).forEach(x => candidatePeers.add(x)));

    const grp = [a];
    visited.add(a.id);
    for (const b of candidatePeers) {
      if (!b || visited.has(b.id)) continue;
      if (same(a, b)) {
        grp.push(b);
        visited.add(b.id);
      }
    }
    if (grp.length > 1) groups.push(grp);
  }

  if (!groups.length) {
    return toast('Повторов не найдено — все записи в твоей коллекции уникальны! ✨');
  }

  const totalExtra = groups.reduce((s, g) => s + g.length - 1, 0);
  const confirmed = await dlgOpen(() => {
    $('dlgTitle').textContent = `🧹 Найдено групп повторов: ${groups.length} (лишних дублей: ${totalExtra})`;
    $('dlgText').textContent = 'Для каждой группы автоматически выбрана самая полная запись, в которую объединятся оценки, заметки, избранное, подборки и пересмотры. Перед запуском автоматически скачается резервная копия.';
    const body = $('dlgBody'); body.replaceChildren();
    const wrap = el('div');
    wrap.style.cssText = 'max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:6px;background:rgba(0,0,0,.25);border-radius:10px;border:1px solid var(--bd);font-size:12.5px';
    groups.forEach(grp => {
      const sorted = [...grp].sort((x, y) => itemCompletenessScore(y) - itemCompletenessScore(x));
      const best = sorted[0];
      const r = el('div', 'row'); r.style.justifyContent = 'space-between';
      r.append(
        el('b', null, `${best.title} (${best.year || '—'}, ${catLabel(best)})`),
        el('span', 'chip', `×${grp.length} → 1 (${best.status}${best.rating ? ', ★' + best.rating : ''})`)
      );
      wrap.append(r);
    });
    body.append(wrap);
  }, `Объединить и удалить ${totalExtra} дублей`, false, () => true);

  if (!confirmed) return;

  window.exportData();
  const snapshotBeforeMerge = items.map(x => ({ ...x }));
  const toUpdate = [];
  const toDelete = [];

  groups.forEach(grp => {
    const sorted = [...grp].sort((x, y) => itemCompletenessScore(y) - itemCompletenessScore(x));
    let winner = { ...sorted[0] };
    for (let k = 1; k < sorted.length; k++) {
      winner = mergeTwoDuplicateItems(winner, sorted[k]);
      toDelete.push(sorted[k]);
    }
    toUpdate.push(winner);
  });

  // Этап 1 п.3: Сначала записываем изменения и удаления в облако, а при сбое откатываем и сообщаем причину!
  if (user && !user.isLocal && auth.currentUser) {
    try {
      const ops = [...toUpdate.map(i => ['s', i]), ...toDelete.map(i => ['d', i])];
      for (let i = 0; i < ops.length; i += 380) {
        const b = writeBatch(db);
        ops.slice(i, i + 380).forEach(([mode, it]) => {
          if (mode === 'd') {
            b.delete(doc(db, 'items', getCloudDocId(it)));
            if (it._docId && it._docId !== getCloudDocId(it)) b.delete(doc(db, 'items', String(it._docId)));
          } else {
            const { docId, payload } = prepareTitleForCloud(it, user.uid);
            b.set(doc(db, 'items', docId), payload);
          }
        });
        await track(b.commit());
      }
    } catch (cloudErr) {
      if (typeof handleCloudError === 'function') handleCloudError(cloudErr, true);
      items = snapshotBeforeMerge;
      saveLocalItems();
      refresh();
      toast('Объединение повторов отменено — ошибка облака: ' + (cloudErr.code || cloudErr.message), true);
      return;
    }
  }

  toUpdate.forEach(winner => {
    const idx = items.findIndex(x => x.id === winner.id);
    if (idx > -1) items[idx] = winner;
  });
  const delSet = new Set(toDelete.map(x => x.id));
  items = deduplicateListByIdAndCleanupCloud(items.filter(i => !delSet.has(i.id)), false);
  saveLocalItems();
  refresh();

  toast(`Объединено групп: ${groups.length}, удалено лишних дублей: ${toDelete.length}!`, false, {
    label: '↩ Отменить объединение',
    fn: async () => {
      try {
        await batchSaveItems(snapshotBeforeMerge);
        items = snapshotBeforeMerge.map(fix);
        saveLocalItems();
        refresh();
        toast('Объединение повторов отменено — все записи возвращены.');
      } catch (e) {
        toast('Не удалось отменить в облаке: ' + (e.code || e.message), true);
      }
    }
  });
}
if ($('dedupMergeBtn')) {
  $('dedupMergeBtn').onclick = async () => {
    if (!(await uiConfirm('Найти и объединить дубликаты в коллекции?\n\nЧто делает эта кнопка: сканирует коллекцию на одинаковые тайтлы (по ID баз и названиям) и предлагает объединить их оценки, теги, списки и пересмотры в одну запись без потери данных.', 'Подтвердить'))) return;
    await findAndMergeDuplicatesModal();
  };
}

// ---------- КНОПКА «🔗 Связать коллекцию с каталогом» (Исправлен Этап 1 п.11) ----------
function hasExternalCatalogId(it) {
  return Boolean(Number(it.aniId) > 0 || Number(it.mal) > 0 || Number(it.shikiId) > 0 || Boolean(it.mdId) || (it.tmdb && String(it.tmdb).includes('/')));
}

// Хранение попыток связывания и очереди спорных совпадений в localStorage (чтобы не засорять документы в базе и восстанавливать очередь после перезагрузки — Этап 1 п.11)
function getLinkAttemptsMap() {
  try { return JSON.parse(localStorage.getItem(getUidStorageKey('linkAttemptsMap')) || '{}'); } catch (e) { return {}; }
}
function recordItemLinkAttempt(itemId) {
  try {
    const m = getLinkAttemptsMap();
    m[String(itemId)] = Date.now();
    localStorage.setItem(getUidStorageKey('linkAttemptsMap'), JSON.stringify(m));
  } catch (e) {}
}
function getItemLastLinkAttempt(it) {
  const m = getLinkAttemptsMap();
  return Number(m[String(it.id)] || it.lastLinkAttempt || 0);
}

let catalogLinkingActive = false;
let catalogLinkingStopRequested = false;

function saveUncertainMatchesCache() {
  const serialized = uncertainMatchesQueue.slice(0, 150).map(u => ({ itemId: u.item.id, candidates: u.candidates }));
  const key = getUidStorageKey('uncertainMatchesCache');
  idbVault.set(key, serialized);
  try {
    localStorage.setItem(key, JSON.stringify(serialized));
  } catch (e) {}
}

async function restoreUncertainMatchesFromStorage() {
  if (!items.length) return;
  try {
    const key = getUidStorageKey('uncertainMatchesCache');
    let raw = await idbVault.get(key);
    if (!Array.isArray(raw) || !raw.length) {
      raw = JSON.parse(localStorage.getItem(key) || '[]');
    }
    if (Array.isArray(raw) && raw.length) {
      const existingIds = new Set(uncertainMatchesQueue.map(u => String(u.item.id)));
      raw.forEach(entry => {
        if (existingIds.has(String(entry.itemId))) return;
        const it = items.find(x => String(x.id) === String(entry.itemId) && !hasExternalCatalogId(x));
        if (it && Array.isArray(entry.candidates) && entry.candidates.length) {
          uncertainMatchesQueue.push({ item: it, candidates: entry.candidates });
          existingIds.add(String(it.id));
        }
      });
    }
    if (uncertainMatchesQueue.length) {
      updateCatalogLinkProgressUI(`📋 Спорные совпадения для проверки: ${uncertainMatchesQueue.length} шт.`, false);
    }
  } catch (e) {}
}

// Этап 1 п.11: НЕ перезаписываем уже существующие aniId, mal и tmdb!
function applyCatalogMatchToItem(it, match, allowFillMissingIds = true) {
  if (allowFillMissingIds) {
    if (match.aniId && !Number(it.aniId)) it.aniId = match.aniId;
    if (match.mal && !Number(it.mal)) it.mal = match.mal;
    if (match.shikiId && !Number(it.shikiId)) it.shikiId = Number(match.shikiId);
    if (match.mdId && !it.mdId) it.mdId = String(match.mdId);
    if (match.tmdb && !it.tmdb) it.tmdb = match.tmdb;
    if (match.imdbId && !it.imdbId) it.imdbId = match.imdbId;
  }
  if (match.format && !it.format) it.format = match.format;
  if (match.isAdult) it.isAdult = true;
  if (match.subKind && it.category === 'Манга' && (!it.subKind || it.subKind === 'Манга')) it.subKind = match.subKind;

  const fbPosters = [];
  const pushP = u => {
    if (isValidPosterUrl(u) && !fbPosters.includes(String(u).trim())) fbPosters.push(String(u).trim());
  };
  pushP(it.poster);
  (it.posterFallbacks || []).forEach(pushP);
  pushP(match.poster);
  (match.posterFallbacks || []).forEach(pushP);
  if (fbPosters.length) {
    if (!isValidPosterUrl(it.poster)) it.poster = fbPosters[0];
    it.posterFallbacks = fbPosters.slice(0, 6);
  }

  const cleanedTrailer = cleanYoutubeId(match.trailerId);
  if (cleanedTrailer && !cleanYoutubeId(it.trailerId)) it.trailerId = cleanedTrailer;
  if (match.title && hasRu(match.title) && !hasRu(it.title)) {
    if (!it.titleEn) it.titleEn = it.title;
    it.title = match.title;
  }
  if (match.en && !it.titleEn) it.titleEn = match.en;
  if (match.romaji && !it.romaji) it.romaji = match.romaji;
  if (match.orig && !it.titleOrig) it.titleOrig = match.orig;
  if (match.alt && !it.alt) it.alt = match.alt;
  if (match.year && !it.year) it.year = String(match.year);
  if (match.endYear && !it.endYear) it.endYear = String(match.endYear);
  if (match.endDate && !it.endDate) it.endDate = String(match.endDate);
  if (match.ext && !it.extRating) { it.extRating = String(match.ext); it.extSrc = match.src || ''; }
  if (match.desc && (!it.description || (hasRu(match.desc) && !hasRu(it.description)))) it.description = match.desc;
  if (match.author && !it.author) it.author = match.author;
  if (match.studio && !it.studio) it.studio = match.studio;
  if (match.cast && !it.cast) it.cast = match.cast;
  if (match.source && !it.source) it.source = match.source;
  if (match.eps && !num(it.eps)) it.eps = match.eps;
  if (match.vols && !num(it.vols)) it.vols = match.vols;
  if (match.dur && !num(it.dur)) it.dur = match.dur;
  if (Array.isArray(match.tags) && match.tags.length) {
    if (!it.tags || !it.tags.length) {
      it.tags = [...match.tags];
    } else {
      const seenTags = new Set(it.tags.map(t => String(t).toLowerCase()));
      for (const tg of match.tags) {
        if (it.tags.length >= 12) break;
        const low = String(tg || '').toLowerCase();
        if (tg && !seenTags.has(low)) { seenTags.add(low); it.tags.push(tg); }
      }
    }
  }
  if (it._knownStatusFromImport !== false) it.needsReview = false;
  delete it._knownStatusFromImport;
  delete it.lastLinkAttempt;
  fix(it);
}

// Этап 1 п.11: Если у тайтла УЖЕ есть aniId, mal, mdId или tmdb — запрашиваем каталог строго по этому ID, а не ищем по названию!
async function findCatalogMatchForItem(it) {
  const isAni = ['Аниме', 'Манга', 'Ранобэ'].includes(it.category);
  if (isAni) {
    const mType = it.category === 'Аниме' ? 'ANIME' : 'MANGA';
    // 1. Если уже есть aniId — запрашиваем строго по id (если AniList доступен)
    if (Number(it.aniId) > 0 && !isAniListBlockedNow()) {
      const byAni = await _anilistRaw(null, mType, { id: Number(it.aniId), per: 1 }).catch(() => []);
      if (byAni[0]) {
        try { await ruFull(byAni[0]); } catch (e) {}
        return { confident: true, match: byAni[0], candidates: byAni };
      }
    }
    // 2. Если уже есть idMal — запрашиваем по idMal (автофоллбэк в Shikimori GraphQL / Jikan при блоке AniList)
    if (Number(it.mal) > 0) {
      const byMal = await _anilistRaw(null, mType, { idMal: Number(it.mal), per: 3, format: it.category === 'Ранобэ' ? 'NOVEL' : undefined }).catch(() => []);
      if (byMal[0]) {
        try { await ruFull(byMal[0]); } catch (e) {}
        return { confident: true, match: byMal[0], candidates: byMal };
      }
    }
    // 2.5 Если уже есть mdId (MangaDex) — догружаем детали напрямую
    if (it.mdId && typeof _mangadexJson === 'function' && typeof mapMangaDexNode === 'function') {
      try {
        const mdResp = await _mangadexJson(`https://api.mangadex.org/manga/${encodeURIComponent(it.mdId)}?includes[]=cover_art&includes[]=author&includes[]=artist`, 6000);
        if (mdResp?.data) {
          const mdNode = mapMangaDexNode(mdResp.data, it.category === 'Ранобэ');
          return { confident: true, match: mdNode, candidates: [mdNode] };
        }
      } catch (e) {}
    }
    // 3. Быстрый и точный поиск по названию (Shikimori GraphQL -> AniList -> Jikan / MangaDex)
    const cleanAnixSearch = s => String(s || '')
      .replace(/\[(?:тв|tv|ova|ona|фильм|movie)[^\]]*\]/gi, ' ')
      .replace(/\((?:тв-?1|tv-?1|тв|tv|сериал)\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const qStr = cleanAnixSearch(it.title || it.titleEn || it.titleOrig);
    if (!qStr) return { confident: false, match: null, candidates: [] };

    const itemNames = nset(it);
    const itemYear = parseInt(it.year) || 0;
    const itemMarker = getItemMarkers(it);

    const calcWordOverlap = (aStr, bStr) => {
      const wa = normTitleStr(aStr).split(' ').filter(w => w.length >= 2);
      const wb = normTitleStr(bStr).split(' ').filter(w => w.length >= 2);
      if (!wa.length || !wb.length) return 0;
      const setB = new Set(wb);
      const common = wa.filter(w => setB.has(w)).length;
      return common / Math.max(wa.length, wb.length, 1);
    };

    const isConfidentTitleOrYearMatch = c => {
      const candNames = nset(c);
      const exactTitle = itemNames.some(n => candNames.includes(n));
      const overlap = Math.max(calcWordOverlap(it.title, c.title), calcWordOverlap(it.titleEn || it.title, c.en));
      const cYear = parseInt(c.year) || 0;
      const hasBothYears = Boolean(itemYear > 0 && cYear > 0);
      const yearDiffLimit = (it.category === 'Манга' || it.category === 'Ранобэ') ? 2 : 1;
      const yearMatch = hasBothYears && Math.abs(itemYear - cYear) <= yearDiffLimit;
      const yearCompatible = !hasBothYears || Math.abs(itemYear - cYear) <= yearDiffLimit;
      const markerOk = getItemMarkers(c) === itemMarker;
      if (!markerOk) return false;
      return (exactTitle && yearCompatible) || (yearMatch && overlap >= 0.85);
    };

    // Шаг 3А: Прямой поиск через Shikimori GraphQL (встроенный фоллбэк на Jikan / MangaDex при ошибке)
    let shCandidates = [];
    try {
      shCandidates = await _shikiCatalogFallback(qStr, mType, {
        per: 6,
        format: it.category === 'Ранобэ' ? 'NOVEL' : undefined
      });
      if (Array.isArray(shCandidates) && shCandidates.length) {
        for (const c of shCandidates) {
          if (isConfidentTitleOrYearMatch(c)) {
            return { confident: true, match: c, candidates: shCandidates, needsFullEnrich: !isAniListBlockedNow() };
          }
        }
      }
    } catch (e) {}

    // Шаг 3Б: Поиск через AniList GraphQL (если доступен)
    const searchEn = it.titleEn || qStr;
    if (!isAniListBlockedNow()) {
      const candidates = await anilist(searchEn, mType, { per: 6 }).catch(() => []);
      if (candidates.length) {
        try { await ruFull(candidates[0]); } catch (e) {}
        for (const c of candidates) {
          if (isConfidentTitleOrYearMatch(c)) {
            try { await ruFull(c); } catch (e) {}
            return { confident: true, match: c, candidates };
          }
        }
        return { confident: false, match: candidates[0], candidates };
      }
    }

    // Шаг 3В: Дополнительный фоллбэк Jikan v4 (+ MangaDex для манги/ранобэ), если Shikimori/AniList не дали точного совпадения
    const extraTasks = [];
    if (typeof _jikanCatalogRaw === 'function') {
      extraTasks.push(_jikanCatalogRaw(searchEn, mType, { per: 6, format: it.category === 'Ранобэ' ? 'NOVEL' : undefined }).catch(() => []));
    }
    if (mType === 'MANGA' && typeof _mangadexCatalogRaw === 'function') {
      extraTasks.push(_mangadexCatalogRaw(searchEn, { per: 6, format: it.category === 'Ранобэ' ? 'NOVEL' : undefined }).catch(() => []));
    }
    if (extraTasks.length) {
      const extraLists = await Promise.all(extraTasks);
      const extraMerged = interleaveAndDedupCatalogLists([shCandidates, ...extraLists]);
      for (const c of extraMerged) {
        if (isConfidentTitleOrYearMatch(c)) {
          try { await ruFull(c); } catch (e) {}
          return { confident: true, match: c, candidates: extraMerged.slice(0, 6) };
        }
      }
      if (extraMerged.length) {
        return { confident: false, match: extraMerged[0], candidates: extraMerged.slice(0, 6) };
      }
    }

    return shCandidates.length
      ? { confident: false, match: shCandidates[0], candidates: shCandidates }
      : { confident: false, match: null, candidates: [] };
  } else {
    const k = getActiveTmdbKey();
    // 1. Если у тайтла УЖЕ есть tmdb ('movie/123' или 'tv/123') — запрашиваем TMDB напрямую по этому ID с трейлерами, актёрами и external_ids!
    if (it.tmdb && /^(movie|tv)\/\d+$/i.test(String(it.tmdb))) {
      try {
        const [mType, rawId] = String(it.tmdb).split('/');
        const d = await fetchTmdbJson(`https://api.themoviedb.org/3/${mType}/${rawId}?api_key=${encodeURIComponent(k)}&language=ru-RU&append_to_response=credits,videos,external_ids&include_video_language=ru,en,null`, 6000);
        if (d && d.id) {
          const orig = d.original_title || d.original_name || '';
          const dir = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
          const by = (d.created_by || []).map(c => c.name);
          const castNames = (d.credits?.cast || []).slice(0, 6).map(c => c.name).filter(Boolean).join(', ');
          const vids = (d.videos?.results || []).filter(v => String(v.site || '').toLowerCase() === 'youtube');
          const pickedVid = vids.find(v => v.type === 'Trailer' && v.iso_639_1 === 'ru')
            || vids.find(v => v.type === 'Trailer' && v.official)
            || vids.find(v => v.type === 'Trailer')
            || vids[0];
          const p342 = d.poster_path ? 'https://image.tmdb.org/t/p/w342' + d.poster_path : '';
          const p500 = d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : '';
          const matchObj = {
            title: d.title || d.name, en: orig, orig, alt: '',
            poster: p342,
            posterFallbacks: [p342, p500].filter(Boolean),
            banner: d.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + d.backdrop_path : '',
            year: (d.release_date || d.first_air_date || '').slice(0, 4),
            ext: d.vote_count ? d.vote_average.toFixed(1) : '',
            tags: (d.genres || []).map(g => g.name || TG[g.id]).filter(Boolean),
            tmdb: mType + '/' + d.id, src: 'TMDB', desc: d.overview || '',
            category: mType === 'tv' ? 'Сериал' : 'Фильм',
            author: [...new Set([...by, ...dir])].slice(0, 2).join(', '),
            studio: (d.production_companies || []).slice(0, 2).map(c => c.name).join(', '),
            cast: castNames,
            trailerId: cleanYoutubeId(pickedVid?.key),
            imdbId: d.external_ids?.imdb_id || '',
            dur: d.runtime || (d.episode_run_time || [])[0] || 0,
            eps: d.number_of_episodes || 0
          };
          return { confident: true, match: matchObj, candidates: [matchObj] };
        }
      } catch (e) {}
    }

    // 2. Поиск по imdbId (с одинарным слэшем /^tt\d+$/i!)
    if (it.imdbId && /^tt\d+$/i.test(it.imdbId)) {
      try {
        const fj = await fetchTmdbJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(it.imdbId)}?api_key=${encodeURIComponent(k)}&language=ru-RU&external_source=imdb_id`, 6000);
        const hitM = (fj.movie_results || [])[0];
        const hitT = (fj.tv_results || [])[0];
        const x = hitM || hitT;
        if (x) {
          const mType = hitM ? 'movie' : 'tv';
          const orig = x.original_title || x.original_name || '';
          const p342 = x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '';
          const p500 = x.poster_path ? 'https://image.tmdb.org/t/p/w500' + x.poster_path : '';
          const matchObj = {
            title: x.title || x.name, en: orig, orig, alt: '',
            poster: p342,
            posterFallbacks: [p342, p500].filter(Boolean),
            year: (x.release_date || x.first_air_date || '').slice(0, 4),
            ext: x.vote_count ? x.vote_average.toFixed(1) : '',
            tags: (x.genre_ids || []).map(g => TG[g]).filter(Boolean),
            tmdb: mType + '/' + x.id, src: 'TMDB', desc: x.overview || '',
            category: mType === 'tv' ? 'Сериал' : 'Фильм'
          };
          try { Object.assign(matchObj, await tmdbInfo(matchObj)); } catch (e) {}
          return { confident: true, match: matchObj, candidates: [matchObj] };
        }
      } catch (e) {}
    }

    // 3. Поиск по названию и году
    const qStr = it.title || it.titleEn || it.titleOrig;
    if (!qStr) return { confident: false, match: null, candidates: [] };
    const candidates = await tmdb(qStr).catch(() => []);
    if (!candidates.length) return { confident: false, match: null, candidates: [] };
    const itemNames = nset(it);
    const itemYear = parseInt(it.year) || 0;

    for (const c of candidates) {
      const candNames = nset(c);
      const exactTitle = itemNames.some(n => candNames.includes(n));
      const cYear = parseInt(c.year) || 0;
      const hasBothYears = Boolean(itemYear > 0 && cYear > 0);
      const yearCompatible = !hasBothYears || Math.abs(itemYear - cYear) <= 1;
      if (exactTitle && yearCompatible && sameCat(c.category, it.category)) {
        try { Object.assign(c, await tmdbInfo(c)); } catch (e) {}
        return { confident: true, match: c, candidates };
      }
    }
    return { confident: false, match: candidates[0], candidates };
  }
}

function updateCatalogLinkProgressUI(text, showStop = true) {
  const bar = $('catalogLinkProgressBar'), txt = $('catalogLinkProgressTxt'), revB = $('catalogLinkReviewBtn'), stopB = $('catalogLinkStopBtn');
  if (!bar || !txt) return;
  bar.style.display = text ? 'flex' : 'none';
  txt.textContent = text || '';
  if (stopB) stopB.style.display = showStop ? '' : 'none';
  if (revB) {
    revB.style.display = uncertainMatchesQueue.length ? '' : 'none';
    revB.textContent = `📋 Подтвердить спорные (${uncertainMatchesQueue.length})`;
  }
}

// Догрузка полных метаданных (описание, жанры, студия, автор, aniId) для совпадений из Shikimori
// пачками по 35 штук за 1 запрос к AniList (ускорение в 20–30 раз без 429) и фоллбэком на детальный API Shikimori
const SHIKI_STUDIO_DESC_CACHE = new Map();
async function enrichItemsByMalIdsBatch(itemsWithMal) {
  const valid = (itemsWithMal || []).filter(i => i && Number(i.mal) > 0 && ['Аниме', 'Манга', 'Ранобэ'].includes(i.category));
  if (!valid.length) return;

  if (!isAniListBlockedNow()) {
    for (const [mType, filterFn] of [['ANIME', i => i.category === 'Аниме'], ['MANGA', i => i.category !== 'Аниме']]) {
      const group = valid.filter(filterFn);
      if (!group.length) continue;
      const mals = [...new Set(group.map(i => Number(i.mal)).filter(Boolean))];
      for (let k = 0; k < mals.length; k += 35) {
        if (catalogLinkingStopRequested || isAniListBlockedNow()) break;
        const chunkMals = mals.slice(k, k + 35);
        let aniListNodes = [];
        try {
          aniListNodes = await _anilistRaw(null, mType, { idMalIn: chunkMals, per: 50 });
        } catch (e) {}
        const byMal = new Map((aniListNodes || []).map(n => [Number(n.mal), n]));
        for (const it of group) {
          const hit = byMal.get(Number(it.mal));
          if (hit) applyCatalogMatchToItem(it, hit, true);
        }
      }
    }
  }

  // Пакетная догрузка русских названий, описаний, жанров, студий и постеров через Shikimori GraphQL (до 50 ID за 1 запрос)
  const needShikiDetail = valid.filter(i => !i.description || !hasRu(i.description) || !(i.tags && i.tags.length) || !isValidPosterUrl(i.poster));
  for (const [mType, field, isAnime, filterFn] of [
    ['ANIME', 'animes', true, i => i.category === 'Аниме'],
    ['MANGA', 'mangas', false, i => i.category !== 'Аниме']
  ]) {
    const group = needShikiDetail.filter(filterFn);
    if (!group.length) continue;
    const mals = [...new Set(group.map(i => Number(i.mal)).filter(Boolean))];
    const extraFields = isAnime
      ? 'episodes episodesAired duration origin studios{name} videos{url kind}'
      : 'chapters volumes publishers{name}';
    const gql = `query($ids:String,$limit:PositiveInt){${field}(ids:$ids,limit:$limit){id malId name russian english japanese synonyms kind status score airedOn{year} releasedOn{year} isCensored genres{id name russian} description poster{originalUrl mainUrl} ${extraFields}}}`;

    for (let k = 0; k < mals.length; k += 50) {
      if (catalogLinkingStopRequested) break;
      const chunkMals = mals.slice(k, k + 50);
      try {
        const gData = await shikiGraphQL(gql, { ids: chunkMals.join(','), limit: chunkMals.length });
        const byMal = new Map();
        (gData?.[field] || []).forEach(node => {
          const mapped = mapShikimoriGraphQLNode(node, mType, false);
          if (mapped.mal) byMal.set(Number(mapped.mal), mapped);
        });
        for (const it of group) {
          const mapped = byMal.get(Number(it.mal));
          if (mapped) {
            if (mapped.desc && hasRu(mapped.desc) && (!it.description || !hasRu(it.description))) {
              it.description = mapped.desc;
            }
            if (Array.isArray(mapped.tags) && mapped.tags.length && (!it.tags || !it.tags.length)) {
              it.tags = mapped.tags;
            }
            applyCatalogMatchToItem(it, mapped, true);
          }
        }
      } catch (e) {}
    }
  }

  // Если у каких-то записей постер всё ещё пустой — дотягиваем через Jikan v4 (cdn.myanimelist.net)
  for (const it of valid) {
    if (catalogLinkingStopRequested) break;
    if (!isValidPosterUrl(it.poster) && Number(it.mal) > 0) {
      const jp = await _fetchJikanPoster(it.mal, it.category);
      if (jp) { it.poster = jp; fix(it); }
    }
  }
}

async function startCatalogLinkingForList(targetList, manualTrigger = false) {
  if (catalogLinkingActive) {
    if (manualTrigger) toast('Связывание с каталогом уже выполняется в фоне');
    return;
  }
  const now = Date.now();
  const queue = (targetList || []).filter(i => {
    if (!i || i.archived) return false;
    if (hasExternalCatalogId(i) && i.poster && i.description && (i.tags || []).length && num(i.eps || i.dur)) return false;
    const lastTry = getItemLastLinkAttempt(i);
    if (!manualTrigger && lastTry && (now - lastTry) < 86400000) return false;
    return true;
  });

  if (!queue.length) {
    restoreUncertainMatchesFromStorage();
    if (manualTrigger) toast('Все тайтлы уже связаны с каталогом (AniList / TMDB) ✓', false, { label: '🧹 Найти повторы', fn: () => findAndMergeDuplicatesModal() });
    return;
  }

  catalogLinkingActive = true;
  catalogLinkingStopRequested = false;
  hideModalElement('dataModal');
  try { localStorage.setItem(getUidStorageKey('catalogLinkPending'), '1'); } catch (e) {}

  let linkedCount = 0;
  let cloudBlockedNotified = false;
  const dirtyBatch = [];
  const flushDirtyBatch = async () => {
    if (!dirtyBatch.length) return;
    const toSave = dirtyBatch.splice(0, dirtyBatch.length);
    toSave.forEach(it => { it.dirty = true; });
    saveLocalItems();
    if (typeof isCloudWriteBlocked === 'function' && isCloudWriteBlocked()) {
      setSync();
      return;
    }
    try {
      await batchSaveItems(toSave);
    } catch (e) {
      if (!cloudBlockedNotified && typeof isCloudQuotaBlocked === 'function' && isCloudQuotaBlocked()) {
        cloudBlockedNotified = true;
        toast('Лимит Firebase исчерпан — продолжу связывание только в локальный кэш браузера.', true);
      }
    }
  };

  // Шаг 1: Тайтлы, у которых УЖЕ есть mal ID (например, после импорта XML/JSON), обогащаем пачками по 35 штук за 1 запрос!
  const alreadyHaveMal = queue.filter(i => Number(i.mal) > 0 && (!i.aniId || !i.description || !(i.tags || []).length));
  if (alreadyHaveMal.length) {
    updateCatalogLinkProgressUI(`⚡ Пакетная загрузка метаданных по ID: ${alreadyHaveMal.length} шт.…`);
    await enrichItemsByMalIdsBatch(alreadyHaveMal);
    alreadyHaveMal.forEach(it => {
      recordItemLinkAttempt(it.id);
      dirtyBatch.push(it);
      linkedCount++;
      updateSingleItemCardInDOM(it.id);
    });
    await flushDirtyBatch();
  }

  // Шаг 2: Оставшиеся без ID тайтлы ищем по названию с защитой от 429 и последующим пакетным обогащением
  const remainingQueue = queue.filter(i => !alreadyHaveMal.includes(i));
  const pendingMalEnrich = [];
  const CONCURRENCY = 2;

  for (let idx = 0; idx < remainingQueue.length; idx += CONCURRENCY) {
    if (catalogLinkingStopRequested) break;
    const slice = remainingQueue.slice(idx, idx + CONCURRENCY);
    updateCatalogLinkProgressUI(`🔗 Связываю с каталогом: ${Math.min(remainingQueue.length, idx + slice.length)} из ${remainingQueue.length} («${slice[0].title}»)… Связано: ${linkedCount}`);

    let hitRateLimit = false;
    await Promise.all(slice.map(async it => {
      try {
        const res = await findCatalogMatchForItem(it);
        // Отмечаем попытку ТОЛЬКО при успешном ответе каталога (не при сетевом сбое / 429)
        recordItemLinkAttempt(it.id);
        if (res.confident && res.match) {
          applyCatalogMatchToItem(it, res.match, true);
          it.needsReview = false;
          if (res.needsFullEnrich && Number(it.mal) > 0) {
            pendingMalEnrich.push(it);
          }
          dirtyBatch.push(it);
          linkedCount++;
          const qIdx = uncertainMatchesQueue.findIndex(u => String(u.item.id) === String(it.id));
          if (qIdx > -1) uncertainMatchesQueue.splice(qIdx, 1);
          updateSingleItemCardInDOM(it.id);
        } else if (res.candidates && res.candidates.length) {
          const existingQ = uncertainMatchesQueue.findIndex(u => String(u.item.id) === String(it.id));
          if (existingQ > -1) uncertainMatchesQueue[existingQ] = { item: it, candidates: res.candidates.slice(0, 4) };
          else uncertainMatchesQueue.push({ item: it, candidates: res.candidates.slice(0, 4) });
        }
      } catch (e) {
        if (e && (e.isRateLimit || /429/.test(e.message || ''))) {
          hitRateLimit = true;
        }
      }
    }));

    if (hitRateLimit) {
      updateCatalogLinkProgressUI('⏳ Пауза 4 сек. (лимит запросов API)…');
      await ruWait(4000);
    }

    if (pendingMalEnrich.length >= 24) {
      const chunk = pendingMalEnrich.splice(0, pendingMalEnrich.length);
      await enrichItemsByMalIdsBatch(chunk);
      chunk.forEach(it => updateSingleItemCardInDOM(it.id));
    }

    if (dirtyBatch.length >= 25) {
      await flushDirtyBatch();
      saveUncertainMatchesCache();
    }
    await ruWait(360);
  }

  if (pendingMalEnrich.length) {
    await enrichItemsByMalIdsBatch(pendingMalEnrich);
    pendingMalEnrich.forEach(it => updateSingleItemCardInDOM(it.id));
    pendingMalEnrich.forEach(it => { if (!dirtyBatch.includes(it)) dirtyBatch.push(it); });
  }

  await flushDirtyBatch();
  catalogLinkingActive = false;
  try { localStorage.removeItem(getUidStorageKey('catalogLinkPending')); } catch (e) {}
  saveUncertainMatchesCache();
  refresh();

  if (uncertainMatchesQueue.length) {
    updateCatalogLinkProgressUI(`🔗 Готово! Автоматически связано: ${linkedCount} из ${queue.length}. Требуют подтверждения: ${uncertainMatchesQueue.length} шт.`, false);
  } else {
    updateCatalogLinkProgressUI('', false);
  }
  // Этап 1 п.11: После связывания предлагаем «🧹 Найти повторы»
  if (manualTrigger || linkedCount > 0) {
    toast(`🔗 Связано с каталогом: ${linkedCount} из ${queue.length} тайтлов!`, false, {
      label: '🧹 Найти повторы',
      fn: () => findAndMergeDuplicatesModal()
    });
  }
}

function resumeBackgroundCatalogLinkingIfNeeded() {
  if (catalogLinkingActive || !items.length) return;
  restoreUncertainMatchesFromStorage();
  const pendingFlag = localStorage.getItem(getUidStorageKey('catalogLinkPending'));
  const unlinked = items.filter(i => !i.archived && !hasExternalCatalogId(i) && (Date.now() - getItemLastLinkAttempt(i)) > 86400000);
  if (pendingFlag && unlinked.length) {
    startCatalogLinkingForList(unlinked, false);
  }
}

if ($('linkCollectionCatalogBtn')) {
  $('linkCollectionCatalogBtn').onclick = () => {
    const needLink = items.filter(i => !i.archived && (!hasExternalCatalogId(i) || !i.poster || (!num(i.eps) && !num(i.dur))));
    startCatalogLinkingForList(needLink, true);
  };
}
if ($('catalogLinkStopBtn')) {
  $('catalogLinkStopBtn').onclick = () => {
    catalogLinkingStopRequested = true;
    try { localStorage.removeItem(getUidStorageKey('catalogLinkPending')); } catch (e) {}
    updateCatalogLinkProgressUI('⏹ Фоновое связывание приостановлено.', false);
  };
}
if ($('catalogLinkReviewBtn')) {
  $('catalogLinkReviewBtn').onclick = () => openUncertainMatchesConfirmDialog();
}

async function openUncertainMatchesConfirmDialog() {
  await restoreUncertainMatchesFromStorage();
  if (!uncertainMatchesQueue.length) return toast('Нет спорных совпадений для подтверждения');
  dlgOpen(() => {
    $('dlgTitle').textContent = `📋 Подтверждение совпадений с каталогом (${uncertainMatchesQueue.length})`;
    $('dlgText').textContent = 'Можно привязать лучший вариант для всех сразу одной кнопкой или выбрать вручную:';
    const body = $('dlgBody'); body.replaceChildren();

    const bulkRow = el('div', 'row');
    bulkRow.style.cssText = 'gap:8px;margin-bottom:6px';
    const acceptAllBtn = el('button', 'btn', `✨ Принять первый вариант для всех (${uncertainMatchesQueue.length})`);
    acceptAllBtn.type = 'button';
    acceptAllBtn.style.cssText = 'flex:1;padding:8px 12px;font-size:12.5px';
    acceptAllBtn.onclick = async () => {
      acceptAllBtn.disabled = true;
      acceptAllBtn.textContent = '⏳ Привязываю все записи…';
      const modified = [];
      while (uncertainMatchesQueue.length) {
        const entry = uncertainMatchesQueue.shift();
        if (entry && entry.item && entry.candidates && entry.candidates[0]) {
          applyCatalogMatchToItem(entry.item, entry.candidates[0], true);
          entry.item.needsReview = false;
          modified.push(entry.item);
        }
      }
      saveUncertainMatchesCache();
      saveLocalItems();
      if (modified.length) await batchSaveItems(modified);
      updateCatalogLinkProgressUI('', false);
      if (dlgDone) dlgDone(true);
      refresh();
      toast(`Связано записей: ${modified.length} шт.!`, false, { label: '🧹 Объединить дубликаты', fn: () => findAndMergeDuplicatesModal() });
    };

    const dismissAllBtn = el('button', 'btn btn-s', '✕ Скрыть список');
    dismissAllBtn.type = 'button';
    dismissAllBtn.style.cssText = 'padding:8px 12px;font-size:12.5px';
    dismissAllBtn.onclick = () => {
      uncertainMatchesQueue.length = 0;
      saveUncertainMatchesCache();
      updateCatalogLinkProgressUI('', false);
      if (dlgDone) dlgDone(true);
      toast('Список спорных совпадений скрыт');
    };
    bulkRow.append(acceptAllBtn, dismissAllBtn);
    body.append(bulkRow);

    const wrap = el('div');
    wrap.style.cssText = 'max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:10px';
    uncertainMatchesQueue.slice(0, 20).forEach(entry => {
      const box = el('div');
      box.style.cssText = 'padding:10px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--bd)';
      box.append(el('b', null, `В коллекции: «${entry.item.title}» (${entry.item.year || 'год не указан'}, ${catLabel(entry.item)})`));
      const cList = el('div'); cList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
      entry.candidates.forEach(cand => {
        const r = el('div', 'u-res-row'); r.style.padding = '6px 8px'; r.style.background = 'rgba(0,0,0,.25)';
        const im = el('img'); im.src = safePosterUrl(cand.poster); im.style.borderRadius = '6px';
        const inf = el('div'); inf.style.flex = '1';
        inf.append(el('b', null, cand.title), el('div', 'meta', `${catLabel(cand)} · ${cand.year || '?'} · ★ ${cand.ext || '—'}`));
        const pickB = el('button', 'btn', 'Выбрать'); pickB.type = 'button'; pickB.style.padding = '5px 10px'; pickB.style.fontSize = '12px';
        pickB.onclick = async () => {
          applyCatalogMatchToItem(entry.item, cand, true);
          entry.item.needsReview = false;
          if (Number(entry.item.mal) > 0 && (!entry.item.description || !(entry.item.tags || []).length)) {
            await enrichItemsByMalIdsBatch([entry.item]);
          }
          await cloudSave(entry.item);
          const qIdx = uncertainMatchesQueue.indexOf(entry);
          if (qIdx > -1) uncertainMatchesQueue.splice(qIdx, 1);
          saveUncertainMatchesCache();
          box.remove();
          refresh();
          toast(`Связано: ${entry.item.title}`, false, { label: '🧹 Найти повторы', fn: () => findAndMergeDuplicatesModal() });
        };
        r.append(im, inf, pickB);
        cList.append(r);
      });
      box.append(cList);
      wrap.append(box);
    });
    body.append(wrap);
  }, 'Готово', false, () => true);
}

// ---------- ВКЛАДКА «📥 Разобрать (N)» (Этап 2 п.5) ----------
function renderReviewItemsTab() {
  const box = $('reviewItemsBox');
  if (!box) return;
  box.replaceChildren();
  const revList = items.filter(i => !i.archived && i.needsReview);
  if (!revList.length) {
    box.append(el('div', 'msg', 'Во вкладке «📥 Разобрать» пусто — все записи проверены и связаны с каталогом!'));
    return;
  }

  const hdr = el('div', 'row'); hdr.style.justifyContent = 'space-between'; hdr.style.marginBottom = '10px';
  hdr.append(
    el('h4', null, `📥 Записи на разбор (${revList.length}) — уточни статус или свяжи с каталогом`),
    el('span', 'meta', `Выделено: ${reviewSelSet.size}`)
  );

  const bar = el('div', 'row'); bar.style.marginBottom = '12px'; bar.style.gap = '6px';
  const btnAll = el('button', 'btn btn-s', `Выбрать все (${revList.length})`); btnAll.type = 'button';
  btnAll.onclick = () => { revList.forEach(i => reviewSelSet.add(i.id)); renderReviewItemsTab(); };
  const btnNone = el('button', 'btn btn-s', 'Снять выделение'); btnNone.type = 'button';
  btnNone.onclick = () => { reviewSelSet.clear(); renderReviewItemsTab(); };

  const stSel = el('select');
  stSel.replaceChildren(new Option('Задать статус выбранным…', ''), ...STATS.map(s => new Option(s, s)));
  stSel.onchange = async () => {
    const v = stSel.value; stSel.value = '';
    if (!v || !reviewSelSet.size) return toast('Сначала отметь записи галочками', true);
    const hit = revList.filter(i => reviewSelSet.has(i.id));
    hit.forEach(i => { i.status = v; i.needsReview = false; });
    reviewSelSet.clear();
    await batchSaveItems(hit);
    refresh();
    renderReviewItemsTab();
    toast(`Статус «${v}» назначен для ${hit.length} записей!`);
  };

  const btnLink = el('button', 'btn btn-s', '🔗 Связать выбранные с каталогом'); btnLink.type = 'button';
  btnLink.onclick = async () => {
    const hit = reviewSelSet.size ? revList.filter(i => reviewSelSet.has(i.id)) : revList;
    await startCatalogLinkingForList(hit, true);
    renderReviewItemsTab();
  };

  const btnApprove = el('button', 'btn btn-s', '✓ Убрать метку «На разбор»'); btnApprove.type = 'button';
  btnApprove.onclick = async () => {
    const hit = reviewSelSet.size ? revList.filter(i => reviewSelSet.has(i.id)) : revList;
    hit.forEach(i => { i.needsReview = false; });
    reviewSelSet.clear();
    await batchSaveItems(hit);
    refresh();
    renderReviewItemsTab();
    toast(`Подтверждено записей: ${hit.length}`);
  };

  const btnDel = el('button', 'btn btn-d', '🗑 Удалить выбранные'); btnDel.type = 'button';
  btnDel.onclick = async () => {
    if (!reviewSelSet.size) return toast('Сначала отметь записи для удаления', true);
    const hit = revList.filter(i => reviewSelSet.has(i.id));
    if (!(await uiConfirm(`Удалить выбранные записи (${hit.length} шт.)?`, 'Удалить', true))) return;
    reviewSelSet.clear();
    await batchDeleteItemsWithUndo(hit, `Удалено из разбора: ${hit.length} шт.`);
    renderReviewItemsTab();
  };

  bar.append(btnAll, btnNone, stSel, btnLink, btnApprove, btnDel);
  box.append(hdr, bar);

  const listWrap = el('div'); listWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto';
  revList.forEach(it => {
    const row = el('div', 'u-res-row'); row.style.border = '1px solid var(--bd)';
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = reviewSelSet.has(it.id); cb.style.width = '18px'; cb.style.height = '18px';
    cb.onchange = () => { if (cb.checked) reviewSelSet.add(it.id); else reviewSelSet.delete(it.id); renderReviewItemsTab(); };
    const im = el('img'); im.src = safePosterUrl(it.poster); im.style.borderRadius = '8px';
    const inf = el('div'); inf.style.flex = '1';
    const linkedTxt = hasExternalCatalogId(it) ? '✓ ID привязан' : '⚠ Без ID каталога';
    inf.append(
      el('b', null, `${it.title} (${it.year || '—'}, ${catLabel(it)})`),
      el('div', 'meta', `${linkedTxt} · Текущий статус: ${it.status}${it.importSource ? ' · Импорт: ' + it.importSource : ''}`)
    );
    const oneLinkB = el('button', 'btn btn-s', '🔗 Найти в каталоге'); oneLinkB.type = 'button';
    oneLinkB.onclick = () => {
      closeAll();
      applyMainTabView('catalog');
      $('cgSearch').value = it.titleEn || it.title;
      $('cgClear').style.display = 'grid';
      cgGo();
    };
    const okB = el('button', 'btn', '✓ ОК'); okB.type = 'button';
    okB.onclick = async () => { it.needsReview = false; await cloudSave(it); refresh(); renderReviewItemsTab(); };
    row.append(cb, im, inf, oneLinkB, okB);
    listWrap.append(row);
  });
  box.append(listWrap);
}

// Безопасная отрисовка баннера выборки (без XSS через название подборки!)
function renderStatusAndCategoryBanner() {
  const banner = $('statusSummaryBanner'); if (!banner) return;
  const vis = getVisibleItems();
  if (!vis.length) { banner.style.display = 'none'; return; }
  const st = $('statusFilter').value, lf = $('listFilter').value;
  banner.style.display = 'flex'; banner.replaceChildren();
  const left = el('div'), right = el('div', 'status-summary-metrics');
  if (st === 'Архив') {
    left.append(el('b', null, '📦 Архив коллекции'), el('div', 'meta', 'Произведения, временно скрытые из основной коллекции.'));
  } else {
    const stLbl = st === 'Все' ? 'Вся активная коллекция' : `Список: «${st}»`;
    const lLbl = lf !== 'Все' ? ` · Подборка «${$('listFilter').selectedOptions[0]?.textContent.replace('📁 ', '')}»` : '';
    left.append(el('b', null, `📊 Статистика выборки (${stLbl}${lLbl})`), el('div', 'meta', 'Учитываются произведения внутри выбранного фильтра'));
  }
  const addP = (l, v) => { const p = el('span', 'status-metric-pill'); p.append(document.createTextNode(l + ': '), el('b', null, v)); right.append(p); };
  addP('Тайтлов', String(lastList.length));
  const an = lastList.filter(i => i.category === 'Аниме');
  if (an.length) addP('🌸 Аниме', `${an.length} шт. · ${formatWatchTimeRu(an.reduce((s, i) => s + getItemMinutes(i), 0))}`);
  const mg = lastList.filter(i => i.category === 'Манга');
  if (mg.length) {
    const ch = mg.reduce((s, i) => s + num(i.eps), 0), vl = mg.reduce((s, i) => s + num(i.vols), 0);
    addP('📖 Манга', `${mg.length} шт. · ${ch} гл.${vl ? ' · ' + vl + ' т.' : ''}`);
  }
  const vd = lastList.filter(i => KINO.includes(i.category));
  if (vd.length) addP('🎬 Кино и сериалы', `${vd.length} шт. · ${formatWatchTimeRu(vd.reduce((s, i) => s + getItemMinutes(i), 0))}`);
  banner.append(left, right);
}

// ---------- ОТРИСОВКА НОВОГО ГИБРИДНОГО ПРОФИЛЯ (Между Скриншотом 1 и Скриншотом 2) ----------
function renderAnixartHeroAndCategoryCards() {
  const vis = getVisibleItems().filter(i => !i.archived);
  const completed = vis.filter(isCompletedItem);
  const doneAnime = completed.filter(i => i.category === 'Аниме');
  const doneVideoAll = completed.filter(i => KINO.includes(i.category));
  const doneManga = completed.filter(i => i.category === 'Манга');
  const doneRanobe = completed.filter(i => i.category === 'Ранобэ');

  const animeMins = doneAnime.reduce((s, i) => s + getItemMinutes(i), 0);
  const videoMinsAll = doneVideoAll.reduce((s, i) => s + getItemMinutes(i), 0);
  const totalWatchMins = animeMins + videoMinsAll;
  const rewatchExtraMins = completed.reduce((s, i) => s + getBaseItemMinutes(i) * Math.max(0, num(i.rewatchCount)), 0);
  const totalEpisodes = completed.filter(i => i.category === 'Аниме' || i.category === 'Сериал').reduce((s, i) => s + getItemEpisodesCount(i), 0);
  const totalChapters = [...doneManga, ...doneRanobe].reduce((s, i) => s + num(i.eps), 0);
  const totalVolumes = [...doneManga, ...doneRanobe].reduce((s, i) => s + num(i.vols), 0);
  const favCount = vis.filter(i => i.fav).length;
  const ratedCount = vis.filter(i => num(i.rating) > 0).length;

  // Плашка «СЕЙЧАС СМОТРЮ» / «СЕЙЧАС ЧИТАЮ» на обложке с правильными единицами (сер. / гл. / мин.) и крестиком скрытия
  const nwBox = $('hybNowWatching');
  if (nwBox) {
    const watchingItem = vis.filter(i => i.status === 'Смотрю/Читаю').sort((a, b) => (b.updatedAt || b.id) - (a.updatedAt || a.id))[0];
    let storedHiddenId = '';
    try { storedHiddenId = localStorage.getItem('hiddenNowWatchingId') || ''; } catch (e) {}
    const hiddenNwId = String(prof.hiddenNowWatchingId || storedHiddenId || '');
    if (watchingItem && String(watchingItem.id) !== hiddenNwId) {
      const isReading = watchingItem.category === 'Манга' || watchingItem.category === 'Ранобэ';
      const nwTag = $('hybNwTag') || nwBox.querySelector('.hyb-nw-tag');
      if (nwTag) nwTag.textContent = isReading ? 'СЕЙЧАС ЧИТАЮ' : 'СЕЙЧАС СМОТРЮ';
      let volStr = '';
      if (isReading) {
        if (num(watchingItem.eps) > 0) volStr = ` · ${watchingItem.eps} гл.`;
        if (num(watchingItem.vols) > 0) volStr += ` (${watchingItem.vols} т.)`;
      } else if (watchingItem.category === 'Фильм') {
        if (num(watchingItem.dur) > 0) volStr = ` · ${watchingItem.dur} мин.`;
        else if (watchingItem.year) volStr = ` · ${watchingItem.year}`;
      } else {
        if (num(watchingItem.eps) > 0) volStr = ` · ${watchingItem.eps} сер.`;
      }
      nwBox.style.display = 'inline-flex';
      applyPosterImg($('hybNwPoster'), watchingItem.poster, watchingItem);
      $('hybNwTitle').textContent = watchingItem.title;
      $('hybNwSub').textContent = `${catLabel(watchingItem)}${volStr}`;
      nwBox.onclick = () => openDetail(watchingItem.id);
      const closeNwBtn = $('hybNwCloseBtn');
      if (closeNwBtn) {
        closeNwBtn.onclick = e => {
          e.stopPropagation();
          const curId = String(watchingItem.id);
          prof.hiddenNowWatchingId = curId;
          try { localStorage.setItem('hiddenNowWatchingId', curId); } catch (err) {}
          profCloud();
          nwBox.style.display = 'none';
        };
      }
    } else {
      nwBox.style.display = 'none';
    }
  }

  const regDate = new Date(prof.createdAt || Date.now());
  const sinceStr = regDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  if ($('hybHeroTimeNum')) {
    $('hybHeroTimeNum').textContent = formatWatchTimeRu(totalWatchMins);
  }
  if ($('hybHeroTimeSub')) {
    $('hybHeroTimeSub').textContent = `общее время просмотра (фильмы, сериалы и аниме) с ${sinceStr}${rewatchExtraMins > 0 ? ' · вкл. пересмотры: ' + formatWatchTimeRu(rewatchExtraMins) : ''}`;
  }

  const qcBox = $('hybQuickCounters');
  if (qcBox) {
    qcBox.replaceChildren();
    const addQc = (val, lbl, onClickFn = null) => {
      const d = el('div', 'hyb-qc-item' + (onClickFn ? ' clickable' : ''));
      d.append(el('b', null, String(val)), el('span', null, lbl));
      if (onClickFn) {
        d.title = 'Нажми, чтобы открыть «Любимое»';
        d.onclick = onClickFn;
      }
      qcBox.append(d);
    };
    addQc(totalEpisodes.toLocaleString('ru-RU'), `${pluralRu(totalEpisodes, 'серия', 'серии', 'серий')} просмотрено`);
    if (totalChapters > 0) addQc(totalChapters.toLocaleString('ru-RU'), `${pluralRu(totalChapters, 'глава', 'главы', 'глав')} прочитано (манга и ранобэ)`);
    if (totalVolumes > 0) addQc(totalVolumes.toLocaleString('ru-RU'), `${pluralRu(totalVolumes, 'том', 'тома', 'томов')} прочитано`);
    addQc(favCount, 'в любимом', () => {
      applyMainTabView('collection');
      if ($('reviewItemsBox')) $('reviewItemsBox').style.display = 'none';
      $('profColWrap').style.display = '';
      $('statusFilter').value = 'Любимое';
      render(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    addQc(ratedCount, pluralRu(ratedCount, 'оценка', 'оценки', 'оценок'));
  }

  if ($('hybTotalListCount')) $('hybTotalListCount').textContent = `${vis.length} ${pluralRu(vis.length, 'тайтл', 'тайтла', 'тайтлов')}`;
  const tot = Math.max(1, vis.length);
  const wWatch = (vis.filter(i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю').length / tot * 100).toFixed(1);
  const wDone = (vis.filter(i => i.status === 'Просмотрено/Прочитано').length / tot * 100).toFixed(1);
  const wPlan = (vis.filter(i => i.status === 'В планах').length / tot * 100).toFixed(1);
  const wDrop = (vis.filter(i => i.status === 'Брошено').length / tot * 100).toFixed(1);
  if ($('hybProgressBar')) {
    $('hybProgressBar').innerHTML = `
      <i style="width:${wWatch}%;background:#10b981"></i>
      <i style="width:${wDone}%;background:#38bdf8"></i>
      <i style="width:${wPlan}%;background:#8b5cf6"></i>
      <i style="width:${wDrop}%;background:#ef4444"></i>
    `;
  }

  const cardsRow = $('hybListCardsRow');
  if (cardsRow) {
    cardsRow.replaceChildren();
    const LIST_DEFS = [
      { st: 'Смотрю/Читаю', title: 'Смотрю', dot: '#10b981', flt: i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю' },
      { st: 'Просмотрено/Прочитано', title: 'Просмотрено', dot: '#38bdf8', flt: i => i.status === 'Просмотрено/Прочитано' },
      { st: 'В планах', title: 'В планах', dot: '#a855f7', flt: i => i.status === 'В планах' },
      { st: 'Любимое', title: 'Любимое', dot: '#ec4899', flt: i => !!i.fav },
      { st: 'Брошено', title: 'Брошено', dot: '#ef4444', flt: i => i.status === 'Брошено' }
    ];
    const curSt = $('statusFilter').value;
    LIST_DEFS.forEach(def => {
      const matched = vis.filter(def.flt);
      const card = el('div', 'hyb-lcard' + (curSt === def.st ? ' active' : ''));
      card.dataset.st = def.st;
      const collage = el('div', 'hyb-lcard-collage');
      const posterItems = matched.filter(x => isValidPosterUrl(x.poster)).slice(0, 3);
      for (let idx = 0; idx < 3; idx++) {
        if (posterItems[idx]) {
          const im = el('img', 'c-slot' + (idx === 0 ? ' main' : ''));
          im.loading = 'lazy';
          applyPosterImg(im, posterItems[idx].poster, posterItems[idx]);
          collage.append(im);
        } else {
          const empty = el('div', 'c-slot' + (idx === 0 ? ' main' : ''));
          collage.append(empty);
        }
      }
      const lbl = el('div', 'hyb-lcard-lbl');
      const dot = el('span'); dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${def.dot};display:inline-block`;
      lbl.append(dot, document.createTextNode(def.title));
      const cnt = el('div', 'hyb-lcard-cnt', `${matched.length} ${pluralRu(matched.length, 'тайтл', 'тайтла', 'тайтлов')}`);
      card.append(collage, lbl, cnt);
      card.onclick = () => {
        applyMainTabView('collection');
        if ($('reviewItemsBox')) $('reviewItemsBox').style.display = 'none';
        $('profColWrap').style.display = '';
        $('statusFilter').value = def.st;
        render(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      cardsRow.append(card);
    });
  }
}



function updateProfileMetaAndPrivacyUI() {
  if (!prof.createdAt) {
    const fbTime = user && !user.isLocal && user.metadata?.creationTime ? new Date(user.metadata.creationTime).getTime() : 0;
    prof.createdAt = fbTime || items.map(born).filter(Boolean).sort((a, b) => a - b)[0] || Date.now();
  }
  const regDate = new Date(prof.createdAt || Date.now());
  if ($('profSince')) {
    const daysOnSite = Math.max(1, Math.floor((Date.now() - regDate.getTime()) / 86400000));
    $('profSince').textContent = `📅 Веду коллекцию с ${regDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} (${daysOnSite} ${pluralRu(daysOnSite, 'день', 'дня', 'дней')})`;
    $('profSince').onclick = () => {
      const exact = regDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' в ' + regDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      dlgOpen(() => { $('dlgTitle').textContent = '📅 Дата создания коллекции'; $('dlgText').textContent = `Профиль создан: ${exact}`; $('dlgBody').replaceChildren(); }, 'ОК', false, () => true);
    };
  }
}

// Отрисовка блоков профиля по образцу Anixart (Скриншоты 4, 6, 7): Кольцевая диаграмма статусов + Жанры, История просмотра и Оценки
function renderAnixartProfileExtras() {
  const vis = getVisibleItems().filter(i => !i.archived);
  const typeGrid = $('anixTypeStatsGrid');
  if (typeGrid) {
    typeGrid.replaceChildren();
    const TYPE_DEFS = [
      ['Аниме', 'Аниме', false],
      ['Кино и сериалы', 'Фильмы и сериалы', false],
      ['Манга', 'Манга', true],
      ['Ранобэ', 'Ранобэ', true]
    ];
    TYPE_DEFS.forEach(([catKey, titleLbl, isRead]) => {
      const allOfType = vis.filter(i => catKey === 'Кино и сериалы' ? KINO.includes(i.category) : i.category === catKey);
      const doneOfType = allOfType.filter(isCompletedItem);
      const card = el('div', 'anix-type-card');
      const top = el('b');
      top.append(document.createTextNode(titleLbl), el('span', 'chip', String(allOfType.length)));
      let subTxt = '';
      if (isRead) {
        const ch = doneOfType.reduce((s, i) => s + num(i.eps), 0);
        const vl = doneOfType.reduce((s, i) => s + num(i.vols), 0);
        subTxt = `Прочитано: ${doneOfType.length}${ch ? ` · ${ch} гл.` : ''}${vl ? ` · ${vl} т.` : ''}`;
      } else {
        const mins = doneOfType.reduce((s, i) => s + getItemMinutes(i), 0);
        subTxt = `Просмотрено: ${doneOfType.length}${mins > 0 ? ' · ' + formatWatchTimeRu(mins) : ''}`;
      }
      card.append(top, el('div', 'meta', subTxt));
      card.onclick = () => {
        applyMainTabView('collection');
        const btn = document.querySelector(`#catFilters .fb[data-c="${catKey}"]`);
        if (btn) btn.click();
      };
      typeGrid.append(card);
    });
  }
}





// ---------- Персонажи и сэйю + Галерея любимых персонажей (Б6) ----------
function enableDragToScroll(trackEl) {
  let isDown = false, startX = 0, scrollL = 0, movedDist = 0;
  trackEl.addEventListener('mousedown', e => {
    if (trackEl.classList.contains('expanded-grid')) return;
    isDown = true; movedDist = 0;
    trackEl.classList.add('dragging-track');
    startX = e.pageX - trackEl.offsetLeft;
    scrollL = trackEl.scrollLeft;
  });
  const stop = () => { isDown = false; trackEl.classList.remove('dragging-track'); };
  trackEl.addEventListener('mouseleave', stop);
  trackEl.addEventListener('mouseup', stop);
  trackEl.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - trackEl.offsetLeft;
    const walk = (x - startX) * 1.4;
    movedDist = Math.abs(walk);
    trackEl.scrollLeft = scrollL - walk;
  });
  trackEl._wasDragged = () => movedDist > 7;
}

const seiyuuRuCache = new Map();
async function openCharacterPopup(ch) {
  const modal = $('charPopupModal'); if (!modal) return;
  applyPosterImg($('charPopPoster'), ch.img, null);
  const badge = $('charPopBadge');
  badge.textContent = ch.role === 'MAIN' ? 'Главный персонаж' : 'Второстепенный персонаж';
  badge.className = 'char-pop-badge' + (ch.role === 'MAIN' ? '' : ' char-pop-badge-sup');

  $('charPopRuName').textContent = ch.name || ch.enName || 'Персонаж';
  $('charPopEnName').textContent = ch.enName || ch.name || '';

  const vaBlock = $('charPopVaBlock');
  if (ch.vaName) {
    vaBlock.style.display = 'block';
    $('charPopVaHdr').textContent = ch.isLiveActor ? 'АКТЁР · РОЛЬ В КАДРЕ' : 'СЕЙЮ · ЯПОНСКАЯ ОЗВУЧКА';
    applyPosterImg($('charPopVaAv'), ch.vaImg, null);
    $('charPopVaEn').textContent = ch.vaName;
    $('charPopVaRu').textContent = seiyuuRuCache.get(ch.vaName) || ch.vaName;
    modal.style.display = 'flex';
    if (!hasRu($('charPopVaRu').textContent) && !seiyuuRuCache.has(ch.vaName)) {
      try {
        const tr = await ruChunk(ch.vaName);
        if (hasRu(tr)) { seiyuuRuCache.set(ch.vaName, tr.trim()); if (seiyuuRuCache.size > 150) seiyuuRuCache.delete(seiyuuRuCache.keys().next().value); $('charPopVaRu').textContent = tr.trim(); }
      } catch (e) {}
    }
    if (!hasRu($('charPopRuName').textContent) && ch.enName) {
      try {
        const trC = await ruChunk(ch.enName);
        if (hasRu(trC)) $('charPopRuName').textContent = trC.trim();
      } catch (e) {}
    }
  } else {
    vaBlock.style.display = 'none';
    modal.style.display = 'flex';
  }

  const favBtn = $('favCharToggleBtn');
  if (favBtn) {
    const favs = prof.favChars || [];
    const key = ch.enName || ch.name;
    const isFav = favs.some(f => f.enName === key);
    favBtn.textContent = isFav ? '💔 Убрать из любимых персонажей' : '❤ Добавить персонажа в любимые';
    favBtn.onclick = () => {
      
      prof.favChars = prof.favChars || [];
      if (prof.favChars.some(f => f.enName === key)) {
        prof.favChars = prof.favChars.filter(f => f.enName !== key);
        toast(`Персонаж «${ch.name}» убран из любимых`);
      } else {
        prof.favChars.push({
          name: $('charPopRuName').textContent || ch.name,
          enName: key,
          img: ch.img || FALL,
          vaName: $('charPopVaRu').textContent || ch.vaName || '',
          vaEn: ch.vaName || '',
          vaImg: ch.vaImg || '',
          role: ch.role || 'MAIN'
        });
        toast(`Персонаж «${$('charPopRuName').textContent || ch.name}» добавлен на полку «Мои любимые герои»!`);
      }
      profCloud(); refresh(); openCharacterPopup(ch);
    };
  }
}
if ($('charPopCloseBtn')) $('charPopCloseBtn').onclick = () => hideModalElement('charPopupModal');

class CharacterSeiyuuManager {
  static cache = new Map();
  static async fetchChars(item) {
    if (!item) return { items: [] };
    if (item.src === 'Комиксы' || item.src === 'Google Books' || item.subKind === 'Комикс' || item.kind === 'Комикс') {
      return { items: [] };
    }
    const k = `${item.category}_${item.aniId || ''}_${item.mal || ''}_${item.tmdb || ''}_${item.titleEn || item.title}`;
    if (this.cache.has(k)) return this.cache.get(k);
    if (['Аниме', 'Манга', 'Ранобэ'].includes(item.category) || item.src === 'AniList') {
      const mType = item.category === 'Аниме' ? 'ANIME' : 'MANGA';
      const isAnime = item.category === 'Аниме';
      const hasDirectId = Boolean(Number(item.aniId) > 0 || Number(item.mal) > 0);
      const q = `query($id:Int,$mal:Int,$s:String,$t:MediaType){Media(id:$id,idMal:$mal,search:$s,type:$t){id idMal status bannerImage format source duration episodes volumes chapters title{romaji english native} synonyms startDate{year month day} endDate{year month day} nextAiringEpisode{airingAt episode} trailer{id site} relations{edges{relationType node{id idMal title{romaji english} format type coverImage{large} startDate{year} averageScore}}} characters(sort:[ROLE,RELEVANCE,ID],perPage:25){edges{role node{name{full native}image{large}}voiceActors(language:JAPANESE,sort:[RELEVANCE,ID]){name{full native}image{large}}}}}}`;
      const vars = { t: mType };
      if (Number(item.aniId) > 0) vars.id = Number(item.aniId);
      else if (Number(item.mal) > 0) vars.mal = Number(item.mal);
      else vars.s = item.romaji || item.titleEn || item.en || item.title;

      let media = null;
      if (!isAniListBlockedNow()) {
        try {
          const j = await fetchAniListGraphQL(q, vars, 2800);
          media = j?.data?.Media || null;
        } catch (aniErr) {}
      }

      if (media && !hasDirectId) {
        const itemNorms = nset(item);
        const mediaNorms = [media.title?.romaji, media.title?.english, media.title?.native, ...(media.synonyms || [])]
          .map(normTitleStr)
          .filter(Boolean);
        if (!itemNorms.some(n => mediaNorms.includes(n))) media = null;
      }

      if (media) {
        const edges = media.characters?.edges || [];
        const ruMap = new Map();
        const malId = Number(media.idMal || item.mal) || 0;
        if (malId && SHK[item.category]) {
          try {
            const field = isAnime ? 'animes' : 'mangas';
            const gChars = await shikiGraphQL(`query($ids:String){${field}(ids:$ids,limit:1){characterRoles{character{name russian}}}}`, { ids: String(malId) });
            (gChars?.[field]?.[0]?.characterRoles || []).forEach(r => {
              if (r.character?.name && r.character?.russian) ruMap.set(ruN(r.character.name), r.character.russian);
            });
          } catch (e) {}
        }
        const res = {
          mediaMeta: media,
          isAnime,
          isLiveAction: false,
          items: edges.map(e => {
            const en = e.node?.name?.full || '', va = (e.voiceActors || [])[0];
            return {
              name: ruMap.get(ruN(en)) || en,
              enName: en,
              role: e.role === 'MAIN' ? 'MAIN' : 'SUP',
              img: isValidPosterUrl(e.node?.image?.large) ? e.node.image.large : '',
              vaName: va?.name?.full || '',
              vaImg: isValidPosterUrl(va?.image?.large) ? va.image.large : '',
              isLiveActor: false
            };
          })
        };
        this.cache.set(k, res);
        if (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value);
        return res;
      }

      // Фоллбэк без VPN: Shikimori GraphQL (дерево франшизы, расписание, трейлер, персонажи) + Jikan v4 (японские сэйю)
      let malId = Number(item.mal) || 0;
      const field = isAnime ? 'animes' : 'mangas';
      if (!malId) {
        const qSearch = item.romaji || item.titleEn || item.en || item.title;
        if (qSearch) {
          try {
            const sRes = await shikiGraphQL(`query($s:String){${field}(search:$s,limit:5){id malId name russian english synonyms}}`, { s: qSearch });
            const itemNorms = nset(item);
            const list = sRes?.[field] || [];
            const exact = list.find(x => [x.name, x.russian, x.english, ...(x.synonyms || [])].map(normTitleStr).some(n => n && itemNorms.includes(n))) || list[0];
            if (exact) malId = Number(exact.malId || exact.id) || 0;
          } catch (e) {}
        }
      }

      let shMedia = null;
      let jikanChars = [];
      if (malId > 0) {
        const detailFields = isAnime
          ? 'id malId status kind airedOn{year month day} releasedOn{year month day} nextEpisodeAt duration episodes episodesAired videos{url kind} related{relationKind relationText anime{id malId name russian kind score airedOn{year} poster{mainUrl}} manga{id malId name russian kind score airedOn{year} poster{mainUrl}}} characterRoles{rolesEn rolesRu character{id name russian poster{originalUrl mainUrl}}}'
          : 'id malId status kind airedOn{year month day} releasedOn{year month day} chapters volumes related{relationKind relationText anime{id malId name russian kind score airedOn{year} poster{mainUrl}} manga{id malId name russian kind score airedOn{year} poster{mainUrl}}} characterRoles{rolesEn rolesRu character{id name russian poster{originalUrl mainUrl}}}';
        const shProm = shikiGraphQL(`query($ids:String){${field}(ids:$ids,limit:1){${detailFields}}}`, { ids: String(malId) })
          .then(d => d?.[field]?.[0] || null)
          .catch(() => null);
        const jProm = isAnime
          ? _jikanJson(`https://api.jikan.moe/v4/anime/${malId}/characters`, 5500).then(j => Array.isArray(j?.data) ? j.data : []).catch(() => [])
          : Promise.resolve([]);
        [shMedia, jikanChars] = await Promise.all([shProm, jProm]);
      }

      const jikanMap = new Map();
      (jikanChars || []).forEach(c => {
        const cName = c.character?.name || '';
        const normName = ruN(cName);
        if (!normName) return;
        const jpVa = (c.voice_actors || []).find(v => v.language === 'Japanese') || (c.voice_actors || [])[0];
        const cImg = c.character?.images?.jpg?.image_url || c.character?.images?.webp?.image_url || '';
        const vaImg = jpVa?.person?.images?.jpg?.image_url || '';
        jikanMap.set(normName, {
          name: cName,
          role: c.role === 'Main' ? 'MAIN' : 'SUP',
          img: isValidPosterUrl(cImg) ? cImg : '',
          vaName: jpVa?.person?.name || '',
          vaImg: isValidPosterUrl(vaImg) ? vaImg : ''
        });
      });

      const REL_MAP = {
        prequel: 'PREQUEL',
        sequel: 'SEQUEL',
        'side story': 'SIDE_STORY',
        side_story: 'SIDE_STORY',
        adaptation: 'ADAPTATION',
        'alternative version': 'ALTERNATIVE',
        'alternative setting': 'ALTERNATIVE',
        alternative: 'ALTERNATIVE',
        summary: 'SUMMARY',
        'parent story': 'PARENT',
        parent_story: 'PARENT',
        'spin-off': 'SPIN_OFF',
        spin_off: 'SPIN_OFF',
        character: 'CHARACTER',
        other: 'OTHER'
      };
      const mapShikiRelFmt = (knd, isRelAnime) => {
        const lk = String(knd || '').toLowerCase();
        if (lk === 'movie') return 'MOVIE';
        if (lk === 'tv') return 'TV';
        if (lk === 'ova') return 'OVA';
        if (lk === 'ona') return 'ONA';
        if (lk === 'special') return 'SPECIAL';
        if (lk === 'light_novel' || lk === 'novel') return 'NOVEL';
        if (lk === 'one_shot') return 'ONE_SHOT';
        return isRelAnime ? 'TV' : 'MANGA';
      };

      let shYtId = '';
      if (Array.isArray(shMedia?.videos)) {
        const pv = shMedia.videos.find(v => /pv|trailer/i.test(v.kind || '')) || shMedia.videos[0];
        shYtId = cleanYoutubeId(pv?.url);
      }

      const relEdges = (shMedia?.related || []).map(rel => {
        const isRelAnime = Boolean(rel.anime);
        const relObj = rel.anime || rel.manga;
        if (!relObj) return null;
        const rk = REL_MAP[String(rel.relationKind || '').toLowerCase()] || 'OTHER';
        return {
          relationType: rk,
          node: {
            id: 0,
            idMal: Number(relObj.malId || relObj.id) || 0,
            title: { english: relObj.russian || relObj.name || '', romaji: relObj.name || '' },
            format: mapShikiRelFmt(relObj.kind, isRelAnime),
            type: isRelAnime ? 'ANIME' : 'MANGA',
            coverImage: { large: pickShikiGraphQLPoster(relObj.poster) },
            startDate: relObj.airedOn || null,
            averageScore: relObj.score ? Math.round(Number(relObj.score) * 10) : 0
          }
        };
      }).filter(Boolean);

      const mediaMeta = shMedia ? {
        idMal: Number(shMedia.malId || malId),
        status: shMedia.status === 'ongoing' ? 'RELEASING' : shMedia.status === 'anons' ? 'NOT_YET_RELEASED' : 'FINISHED',
        startDate: shMedia.airedOn || null,
        endDate: shMedia.releasedOn || null,
        nextAiringEpisode: shMedia.nextEpisodeAt ? {
          airingAt: Math.floor(new Date(shMedia.nextEpisodeAt).getTime() / 1000),
          episode: (Number(shMedia.episodesAired) || 0) + 1
        } : null,
        trailer: shYtId ? { site: 'youtube', id: shYtId } : null,
        relations: { edges: relEdges }
      } : null;

      let charItems = [];
      const rawRoles = Array.isArray(shMedia?.characterRoles) ? shMedia.characterRoles : [];
      if (rawRoles.length) {
        const sortedRoles = [...rawRoles].sort((a, b) => {
          const am = (a.rolesEn || []).some(r => /main/i.test(r)) ? 0 : 1;
          const bm = (b.rolesEn || []).some(r => /main/i.test(r)) ? 0 : 1;
          return am - bm;
        }).slice(0, 25);
        charItems = sortedRoles.map(cr => {
          const en = cr.character?.name || '';
          const jHit = jikanMap.get(ruN(en));
          const shImg = pickShikiGraphQLPoster(cr.character?.poster);
          return {
            name: cr.character?.russian || en,
            enName: en,
            role: (cr.rolesEn || []).some(r => /main/i.test(r)) ? 'MAIN' : 'SUP',
            img: isValidPosterUrl(shImg) ? shImg : (jHit?.img || ''),
            vaName: jHit?.vaName || '',
            vaImg: jHit?.vaImg || '',
            isLiveActor: false
          };
        });
      } else if (jikanChars.length) {
        charItems = jikanChars.slice(0, 25).map(c => {
          const jHit = jikanMap.get(ruN(c.character?.name || ''));
          return {
            name: c.character?.name || '',
            enName: c.character?.name || '',
            role: c.role === 'Main' ? 'MAIN' : 'SUP',
            img: jHit?.img || '',
            vaName: jHit?.vaName || '',
            vaImg: jHit?.vaImg || '',
            isLiveActor: false
          };
        });
      }

      const fbRes = { mediaMeta, isAnime, isLiveAction: false, items: charItems };
      this.cache.set(k, fbRes);
      if (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value);
      return fbRes;
    }
    const tk = getActiveTmdbKey();
    if (tk && item.tmdb) {
      const d = await fetchTmdbJson(`https://api.themoviedb.org/3/${item.tmdb}?api_key=${encodeURIComponent(tk)}&language=ru-RU&append_to_response=credits,videos,external_ids&include_video_language=ru,en,null`, 6000);
      const cast = d?.credits?.cast || d?.cast || [];
      const dir = (d?.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
      const by = (d?.created_by || []).map(c => c.name);
      const vids = (d?.videos?.results || []).filter(v => String(v.site || '').toLowerCase() === 'youtube');
      const pickedVid = vids.find(v => v.type === 'Trailer' && v.iso_639_1 === 'ru')
        || vids.find(v => v.type === 'Trailer' && v.official)
        || vids.find(v => v.type === 'Trailer')
        || vids[0];
      const ytKey = cleanYoutubeId(pickedVid?.key);
      const res = {
        isAnime: false,
        isLiveAction: true,
        mediaMeta: {
          bannerImage: d?.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + d.backdrop_path : '',
          isOngoingTmdb: d?.status === 'Returning Series' || d?.status === 'In Production',
          nextEpAirDate: d?.next_episode_to_air?.air_date || d?.last_air_date || d?.first_air_date || '',
          endDateStr: d?.last_air_date || '',
          nextEpNum: d?.next_episode_to_air?.episode_number || 0,
          trailer: ytKey ? { site: 'youtube', id: ytKey } : null,
          author: [...new Set([...by, ...dir])].slice(0, 2).join(', '),
          studio: (d?.production_companies || []).slice(0, 2).map(c => c.name).join(', '),
          castNames: cast.slice(0, 6).map(c => c.name).filter(Boolean).join(', '),
          imdbId: d?.external_ids?.imdb_id || ''
        },
        items: cast.slice(0, 20).map((c, idx) => ({ name: c.character || c.name, enName: c.original_name || c.name, role: idx < 4 ? 'MAIN' : 'SUP', img: c.profile_path ? 'https://image.tmdb.org/t/p/w342' + c.profile_path : FALL, vaName: c.name || '', vaImg: c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : '', isLiveActor: true }))
      };
      this.cache.set(k, res);
      if (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value);
      return res;
    }
    return { items: [] };
  }
  static async render(box, item) {
    if (!box || !item) return;
    box.style.display = 'block'; box.replaceChildren(el('div', 'meta', 'Загрузка персонажей…'));
    try {
      const data = await this.fetchChars(item);
      if (!data.items.length) { box.style.display = 'none'; return; }
      box.replaceChildren();
      const hdr = el('div', 'jutsu-hdr'), tw = el('div', 'jutsu-hdr-title');
      const secTitle = data.isAnime ? 'Персонажи и сэйю' : data.isLiveAction ? 'Актёры и роли' : 'Персонажи';
      const secSub = data.isAnime ? 'Нажми на героя, чтобы открыть карточку сэйю или добавить в «Мои любимые герои»' : data.isLiveAction ? 'Главные актёры и исполнители ролей' : 'Главные и второстепенные герои';
      tw.innerHTML = `<h4><span style="color:#d946ef">👤</span> ${secTitle}</h4><div class="jutsu-hdr-sub">${secSub}</div>`;
      const nav = el('div', 'jutsu-nav-btns'), pB = el('button', 'jutsu-arrow', '←'), nB = el('button', 'jutsu-arrow', '→');
      pB.type = nB.type = 'button'; nav.append(pB, nB); hdr.append(tw, nav);
      const track = el('div', 'jutsu-track');
      enableDragToScroll(track);
      pB.onclick = () => track.scrollBy({ left: -380, behavior: 'smooth' }); nB.onclick = () => track.scrollBy({ left: 380, behavior: 'smooth' });
      let exp = false;
      const draw = () => {
        track.replaceChildren(); track.classList.toggle('expanded-grid', exp); nav.style.display = exp ? 'none' : 'flex';
        (exp ? data.items : data.items.slice(0, 8)).forEach(ch => {
          const c = el('div', 'j-char-card' + (ch.role === 'MAIN' ? ' is-main' : '')), art = el('div', 'j-char-art'), im = el('img', 'j-char-img');
          im.loading = 'lazy'; applyPosterImg(im, ch.img, null); art.append(im);
          if (ch.role === 'MAIN') art.append(el('span', 'j-main-badge', 'Главный'));
          if (ch.vaImg) { const vw = el('div', 'j-va-avatar'), vi = el('img'); vi.loading = 'lazy'; applyPosterImg(vi, ch.vaImg, null); vw.append(vi); art.append(vw); }
          c.append(art, el('div', 'j-char-name', ch.name));
          if (ch.vaName) c.append(el('div', 'j-va-name', ch.vaName));
          c.onclick = () => { if (track._wasDragged && track._wasDragged()) return; openCharacterPopup(ch); };
          track.append(c);
        });
      };
      draw(); box.append(hdr, track);
      if (data.items.length > 8) {
        const w = el('div', 'jutsu-toggle-wrap'), b = el('button', 'jutsu-toggle-btn', `ПОКАЗАТЬ ВСЕХ (${data.items.length})`);
        b.type = 'button'; b.onclick = () => { exp = !exp; b.textContent = exp ? 'СВЕРНУТЬ ▲' : `ПОКАЗАТЬ ВСЕХ (${data.items.length})`; draw(); };
        w.append(b); box.append(w);
      }
    } catch (e) { box.style.display = 'none'; }
  }
}

// ---------- Полная внутренняя страница тайтла: Дерево франшизы с галочками (Б1), Трейлер YouTube (Б2), Опенинги/Эндинги AnimeThemes (Б3) и фикс Ранобэ (Ошибка №11) ----------
// FORMAT_RU и REL_RU объявлены в начале модуля

const _fullPageHistoryItems = new Map();

async function openFullTitlePage(itemObj, fromHistory = false) {
  if (!itemObj) return;
  closeAll(true);
  const page = $('titlePageView'); if (!page) return;
  $('catalogView').style.display = 'none';
  $('profileView').style.display = 'none';
  page.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const inCol = items.find(i => i.id === itemObj.id || same(i, itemObj));
  const activeItem = inCol || itemObj;
  const stateKey = String(activeItem.id || activeItem.aniId || activeItem.mal || activeItem.tmdb || activeItem.title);
  _fullPageHistoryItems.set(stateKey, activeItem);
  if (_fullPageHistoryItems.size > 80) _fullPageHistoryItems.delete(_fullPageHistoryItems.keys().next().value);

  const curTab = document.querySelector('#mainTabs .tab.on')?.dataset.v || 'catalog';
  if (!fromHistory) {
    pushAppHistoryState({ tab: curTab, fullPage: true, titleKey: stateKey });
  }

  page.replaceChildren();
  const backWrap = el('div'); backWrap.style.marginBottom = '14px';
  const backBtn = el('button', 'btn btn-s', '← Назад'); backBtn.type = 'button';
  backBtn.onclick = () => {
    if (history.state && history.state.fullPage) {
      history.back();
    } else {
      page.style.display = 'none';
      const activeTab = document.querySelector('#mainTabs .tab.on')?.dataset.v || 'catalog';
      applyMainTabView(activeTab, true);
    }
  };
  backWrap.append(backBtn);

  // Карточка тайтла в стиле Jut-su (Скриншот 5): слева постер, по центру информация, справа — мягкий фоновый арт главного героя / баннера
  const wrap = el('div', 'tp-wrap'), hero = el('div', 'tp-hero');
  const heroArtBg = el('div', 'tp-hero-art-bg');
  const initialArt = safePosterUrl(activeItem.banner || activeItem.poster);
  if (initialArt && initialArt !== FALL) {
    heroArtBg.style.backgroundImage = `url("${initialArt.replace(/["\\()\r\n]/g, '')}")`;
  }
  const posterImg = el('img', 'tp-poster'); applyPosterImg(posterImg, activeItem.poster, activeItem);
  const heroInfo = el('div');
  const badgesRow = el('div', 'row'); badgesRow.style.marginBottom = '8px';
  const stPill = el('span', 'status', activeItem.status ? getStatusLabelForCategory(activeItem.status, activeItem.category) : 'В каталоге'); stPill.dataset.s = activeItem.status || 'В планах';
  badgesRow.append(stPill);
  if (activeItem.fav) badgesRow.append(el('span', 'chip', '❤ Любимое'));
  if (activeItem.ongoing) badgesRow.append(el('span', 'ong', 'ОНГОИНГ'));
  badgesRow.append(el('span', 'chip', catLabel(activeItem)));

  const titleH1 = el('h1', null, activeItem.title); titleH1.style.cssText = 'margin:0 0 6px;font-size:26px';
  const subNames = el('div', 'meta', [activeItem.titleEn || activeItem.en, activeItem.titleOrig || activeItem.orig].filter(Boolean).join(' / '));
  const specsGrid = el('div', 'tp-specs-grid');
  const tagsBox = el('div', 'chips'); tagsBox.style.margin = '12px 0';
  (activeItem.tags || []).forEach(t => tagsBox.append(el('span', 'chip', t)));
  const actRow = el('div', 'row'); actRow.style.marginTop = '12px';

  const addSpec = (lbl, val) => {
    if (!val) return null;
    const b = el('div', 'tp-spec-box');
    b.append(el('span', null, lbl), el('b', null, String(val)));
    specsGrid.append(b);
    return b;
  };
  const formatReleasePeriodText = (item, meta = null) => {
    const startYr = item.year || (meta?.startDate?.year ? String(meta.startDate.year) : '');
    const isOng = Boolean(item.ongoing || meta?.status === 'RELEASING' || meta?.isOngoingTmdb);
    if (isOng) {
      return startYr ? `${startYr} — выходит (онгоинг)` : 'выходит (онгоинг)';
    }
    let endFull = item.endDate || '';
    let endYr = item.endYear || '';
    if (!endFull && meta?.endDate?.year) {
      endYr = String(meta.endDate.year);
      endFull = [meta.endDate.day, meta.endDate.month, meta.endDate.year].filter(Boolean).map(n => String(n).padStart(2, '0')).join('.');
    } else if (!endFull && meta?.endDateStr) {
      const p = String(meta.endDateStr).slice(0, 10).split('-');
      if (p.length === 3) {
        endYr = p[0];
        endFull = `${p[2]}.${p[1]}.${p[0]}`;
      } else {
        endFull = String(meta.endDateStr);
      }
    }
    if (endFull && endFull !== startYr) {
      return startYr ? `${startYr} — ${endFull}` : endFull;
    }
    if (endYr && endYr !== startYr) {
      return startYr ? `${startYr} — ${endYr}` : endYr;
    }
    return startYr || 'Не указан';
  };
  const releaseSpecBox = addSpec('Годы / Дата выхода', formatReleasePeriodText(activeItem, null));
  addSpec('Тип произведения', FORMAT_RU[activeItem.format] || catLabel(activeItem));
  addSpec('Первоисточник', activeItem.source || 'Оригинал / Не указан');
  const addClickableSpec = (lbl, rawVal, kindType) => {
    const list = spl(rawVal);
    if (!list.length) return addSpec(lbl, 'Не указан');
    const b = el('div', 'tp-spec-box');
    const chips = el('div', 'chips');
    chips.style.margin = '2px 0 0';
    list.forEach(nameStr => {
      const ch = el('button', 'chip', nameStr + ' ↗');
      ch.type = 'button';
      ch.title = `Показать все работы: ${nameStr}`;
      ch.onclick = () => openCatalogByCreator(kindType, nameStr, activeItem.category);
      chips.append(ch);
    });
    b.append(el('span', null, lbl), chips);
    specsGrid.append(b);
  };
  addClickableSpec('Автор / Режиссёр', activeItem.author, 'author');
  addClickableSpec('Студия / Издатель', activeItem.studio, 'studio');
  if (activeItem.cast) addSpec('В главных ролях', activeItem.cast);
  if (activeItem.category === 'Манга' || activeItem.category === 'Ранобэ') {
    addSpec('Объём (Главы и Тома)', `${num(activeItem.eps) || '?'} гл. · ${num(activeItem.vols) || '?'} т.`);
  } else {
    addSpec('Количество серий', num(activeItem.eps) ? `${activeItem.eps} эп.` : (activeItem.category === 'Фильм' ? 'Полнометражный фильм' : 'Не указано'));
    addSpec('Длительность', num(activeItem.dur) ? `${activeItem.dur} мин. (${formatWatchTimeRu(getItemMinutes(activeItem))} всего)` : formatWatchTimeRu(getItemMinutes(activeItem)));
  }
  addSpec('Внешний рейтинг', (activeItem.extRating || activeItem.ext) ? `★ ${activeItem.extRating || activeItem.ext}` : '—');
  addSpec('Моя оценка', activeItem.rating ? `★ ${activeItem.rating} / 10` : 'Не оценено');
  if (inCol) {
    const addDt = formatAddedDateRu(inCol);
    if (addDt) addSpec(`Добавлено в «${getStatusLabelForCategory(inCol.status, inCol.category)}»`, addDt);
  }

  const fullPageSimBox = el('div', 'chips');
  fullPageSimBox.style.marginTop = '10px';
  {
    const curMatch = items.find(x => same(x, activeItem));
    const stB = el('button', 'btn qa-trigger', curMatch ? `✓ ${SHORT_ST_BTN[curMatch.status] || curMatch.status}${curMatch.fav ? ' ❤' : ''} ▾` : '＋ Выбрать статус ▾');
    stB.type = 'button';
    stB.onclick = e => {
      e.stopPropagation();
      openQuickAddStatusMenu(stB, activeItem, updated => {
        stB.textContent = updated ? `✓ ${SHORT_ST_BTN[updated.status] || updated.status}${updated.fav ? ' ❤' : ''} ▾` : '＋ Выбрать статус ▾';
      });
    };
    actRow.append(stB);
    // Кнопка «✏ Редактировать» отображается ТОЛЬКО у тайтлов, созданных вручную (без привязки к внешнему каталогу)
    if (curMatch && !hasExternalCatalogId(curMatch)) {
      const edB = el('button', 'btn btn-s', '✏ Редактировать');
      edB.type = 'button';
      edB.onclick = () => openAdd(curMatch);
      actRow.append(edB);
    }
  }
  const simBtnFp = el('button', 'btn btn-s', '🔗 Похожие');
  simBtnFp.type = 'button';
  simBtnFp.onclick = async () => {
    simBtnFp.disabled = true;
    simBtnFp.textContent = '⏳ Ищу похожие…';
    await loadSimilarTitlesIntoBox(activeItem, fullPageSimBox);
    simBtnFp.textContent = '🔗 Похожие ✓';
  };
  actRow.append(simBtnFp);

  heroInfo.append(badgesRow, titleH1, subNames, specsGrid, tagsBox, actRow, fullPageSimBox);
  hero.append(heroArtBg, posterImg, heroInfo);

  const descHdr = el('h3', null, '📖 Описание и синопсис'); descHdr.style.margin = '22px 0 8px';
  const descBody = el('div', null, activeItem.description || activeItem.desc || 'Описание отсутствует.');
  descBody.style.cssText = 'background:rgba(0,0,0,.25);padding:14px;border-radius:12px;line-height:1.6;white-space:pre-wrap';

  const mediaRowSec = el('div', 'dash'); mediaRowSec.style.marginTop = '18px';
  const trailerBox = el('div', 'pb'); trailerBox.style.display = 'none';
  const themesBox = el('div', 'pb'); themesBox.style.display = 'none';
  mediaRowSec.append(trailerBox, themesBox);

  const charsSec = el('div', 'jutsu-chars-sec'); charsSec.style.marginTop = '18px'; charsSec.style.display = 'none';
  const franchiseSec = el('div'); franchiseSec.style.marginTop = '20px'; franchiseSec.style.display = 'none';
  const franchiseHdr = el('h3', null, '🌳 Франшиза и порядок просмотра'); franchiseHdr.style.margin = '0 0 8px';
  const relGrid = el('div', 'tp-rel-grid');
  franchiseSec.append(franchiseHdr, relGrid);

  wrap.append(hero, descHdr, descBody, mediaRowSec, charsSec, franchiseSec);
  page.append(backWrap, wrap);

  await CharacterSeiyuuManager.render(charsSec, activeItem);
  const cachedData = await CharacterSeiyuuManager.fetchChars(activeItem);
  const mediaMeta = cachedData?.mediaMeta;
  if (releaseSpecBox && mediaMeta) {
    const bEl = releaseSpecBox.querySelector('b');
    if (bEl) bEl.textContent = formatReleasePeriodText(activeItem, mediaMeta);
  }
  if (mediaMeta?.castNames && !activeItem.cast) {
    activeItem.cast = mediaMeta.castNames;
    addSpec('В главных ролях', mediaMeta.castNames);
  }
  if (mediaMeta?.imdbId && !activeItem.imdbId) activeItem.imdbId = mediaMeta.imdbId;

  // Вывод дня недели и даты выхода серий для онгоингов на полной странице тайтла
  const isOngoingNow = Boolean(activeItem.ongoing || mediaMeta?.status === 'RELEASING' || mediaMeta?.isOngoingTmdb);
  if (isOngoingNow) {
    const WEEKDAYS_ACC = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];
    const WEEKDAYS_NOM = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    let scheduleText = '';
    if (mediaMeta?.nextAiringEpisode?.airingAt) {
      const airDate = new Date(mediaMeta.nextAiringEpisode.airingAt * 1000);
      const dayIdx = airDate.getDay();
      const dateStr = airDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      const timeStr = airDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const epNum = mediaMeta.nextAiringEpisode.episode;
      scheduleText = `По ${WEEKDAYS_ACC[dayIdx]} (${WEEKDAYS_NOM[dayIdx]}) · ${epNum ? epNum + ' серия — ' : ''}${dateStr} в ${timeStr}`;
    } else if (mediaMeta?.nextEpAirDate) {
      const airDate = new Date(mediaMeta.nextEpAirDate + 'T12:00:00');
      if (!isNaN(airDate.getTime())) {
        const dayIdx = airDate.getDay();
        const dateStr = airDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        scheduleText = `По ${WEEKDAYS_ACC[dayIdx]} (${WEEKDAYS_NOM[dayIdx]})${mediaMeta.nextEpNum ? ` · ${mediaMeta.nextEpNum} серия — ${dateStr}` : ''}`;
      }
    } else if (mediaMeta?.startDate?.year && mediaMeta?.startDate?.month && mediaMeta?.startDate?.day) {
      const stDate = new Date(mediaMeta.startDate.year, mediaMeta.startDate.month - 1, mediaMeta.startDate.day, 12, 0, 0);
      if (!isNaN(stDate.getTime())) {
        const dayIdx = stDate.getDay();
        scheduleText = `По ${WEEKDAYS_ACC[dayIdx]} (${WEEKDAYS_NOM[dayIdx]})`;
      }
    }
    if (scheduleText) {
      addSpec('📅 Расписание выхода (Онгоинг)', scheduleText);
    }
  }

  // Устанавливаем на правую часть шапки портрет главного героя или широкоформатный баннер (как на Jut-su, Скриншот 5)
  const mainCharImg = (cachedData?.items || []).find(c => c.role === 'MAIN' && c.img && c.img !== FALL)?.img || (cachedData?.items || [])[0]?.img || '';
  const bestArtUrl = safePosterUrl(mediaMeta?.bannerImage || activeItem.banner || mainCharImg || activeItem.poster);
  if (bestArtUrl && bestArtUrl !== FALL) {
    heroArtBg.style.backgroundImage = `url("${bestArtUrl.replace(/["\\()\r\n]/g, '')}")`;
  }

  // Отрисовка Трейлера YouTube + кнопки открытия (Б2)
  const ytId = cleanYoutubeId(activeItem.trailerId) || cleanYoutubeId(mediaMeta?.trailer?.site === 'youtube' ? mediaMeta.trailer.id : '');
  if (ytId) {
    if (!activeItem.trailerId) activeItem.trailerId = ytId;
    trailerBox.style.display = 'block';
    const th = el('div', 'row'); th.style.justifyContent = 'space-between'; th.style.marginBottom = '10px';
    th.append(el('h4', null, '🎬 Официальный трейлер'));
    const extYt = el('a', 'btn btn-s', 'Открыть на YouTube ↗');
    extYt.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(ytId);
    extYt.target = '_blank'; extYt.rel = 'noopener'; extYt.style.fontSize = '12px'; extYt.style.padding = '6px 10px';
    th.append(extYt);
    const ifr = el('iframe');
    ifr.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(ytId);
    ifr.style.cssText = 'width:100%;aspect-ratio:16/9;border:0;border-radius:12px;background:#000';
    ifr.allowFullscreen = true;
    trailerBox.append(th, ifr);
  } else {
    const ytSuffix = ['Аниме', 'Манга', 'Ранобэ'].includes(activeItem.category) ? ' anime trailer' : ' официальный трейлер';
    const searchYt = el('a', 'btn btn-s', '🎬 Найти трейлер на YouTube ↗');
    searchYt.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent((activeItem.titleEn || activeItem.title) + ytSuffix);
    searchYt.target = '_blank'; searchYt.rel = 'noopener';
    actRow.append(searchYt);
  }

  // Загрузка Опенингов и Эндингов через открытый API AnimeThemes (Б3) с прокси-фоллбэком
  const malId = activeItem.mal || mediaMeta?.idMal;
  if (activeItem.category === 'Аниме' && malId) {
    const atUrl = `https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=${encodeURIComponent(malId)}&include=animethemes.animethemeentries.videos.audio,animethemes.song.artists`;
    const fetchAnimeThemes = async () => {
      if (!window._animeThemesCorsBlocked) {
        try {
          return await ruJson(atUrl, 4500);
        } catch (e) {
          window._animeThemesCorsBlocked = true;
        }
      }
      return await Promise.any([
        ruJson('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(atUrl), 5500),
        ruJson('https://api.allorigins.win/raw?url=' + encodeURIComponent(atUrl), 5500)
      ]);
    };
    fetchAnimeThemes()
      .then(j => {
        const themes = j?.anime?.[0]?.animethemes || [];
        if (!themes.length) return;
        themesBox.style.display = 'block';
        themesBox.replaceChildren(el('h4', null, `🎵 Опенинги и Эндинги (${themes.length})`));
        const listWrap = el('div'); listWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto';
        const playerBox = el('div'); playerBox.style.marginTop = '10px';
        themes.forEach(th => {
          const slug = th.slug || th.type || 'OP';
          const songTitle = th.song?.title || 'Без названия';
          const artist = (th.song?.artists || []).map(a => a.name).join(', ');
          const vid = th.animethemeentries?.[0]?.videos?.[0];
          const audioUrl = vid?.audio?.link || vid?.link || '';
          const row = el('div', 'row'); row.style.cssText = 'justify-content:space-between;padding:7px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--bd)';
          const inf = el('div');
          inf.append(el('b', null, `${slug} — ${songTitle}`), el('div', 'meta', artist || 'Оригинальный саундтрек'));
          row.append(inf);
          if (audioUrl) {
            const playB = el('button', 'btn btn-s', '▶ Слушать'); playB.type = 'button'; playB.style.padding = '5px 10px'; playB.style.fontSize = '12px';
            playB.onclick = () => {
              playerBox.replaceChildren();
              if (audioUrl.endsWith('.ogg') || audioUrl.endsWith('.mp3')) {
                const aud = el('audio'); aud.controls = true; aud.autoplay = true; aud.src = audioUrl; aud.style.width = '100%';
                playerBox.append(aud);
              } else {
                const vd = el('video'); vd.controls = true; vd.autoplay = true; vd.src = audioUrl; vd.style.cssText = 'width:100%;max-height:200px;border-radius:10px';
                playerBox.append(vd);
              }
            };
            row.append(playB);
          }
          listWrap.append(row);
        });
        themesBox.append(listWrap, playerBox);
      }).catch(() => {});
  }

  // Дерево просмотра франшизы с пронумерованным маршрутом, отметками «✓ В коллекции» и корректным определением Ранобэ (Б1 + Ошибка №11)
  const relEdges = mediaMeta?.relations?.edges || [];
  if (relEdges.length) {
    franchiseSec.style.display = 'block';
    const ORDER_WEIGHT = { PREQUEL: 1, PARENT: 2, SEQUEL: 3, SIDE_STORY: 4, SPIN_OFF: 5, ADAPTATION: 6, SUMMARY: 7, ALTERNATIVE: 8 };
    const sortedEdges = [...relEdges].sort((a, b) => {
      const wa = ORDER_WEIGHT[a.relationType] || 9, wb = ORDER_WEIGHT[b.relationType] || 9;
      if (wa !== wb) return wa - wb;
      return (a.node?.startDate?.year || 9999) - (b.node?.startDate?.year || 9999);
    });
    sortedEdges.forEach((edge, idx) => {
      const node = edge.node; if (!node) return;
      const titleStr = node.title?.english || node.title?.romaji || 'Произведение';
      const resolvedCat = node.type === 'ANIME' ? 'Аниме' : node.format === 'NOVEL' ? 'Ранобэ' : 'Манга';
      const matchedInCol = items.find(i => (node.id && Number(i.aniId) === Number(node.id)) || (node.idMal && Number(i.mal) === Number(node.idMal)) || same(i, { title: titleStr, category: resolvedCat }));
      const card = el('div', 'tp-rel-card' + (matchedInCol ? ' in-col' : ''));
      const im = el('img');
      applyPosterImg(im, node.coverImage?.large, { mal: node.idMal, category: resolvedCat });
      const inf = el('div'); inf.style.minWidth = '0';
      const stepBadge = el('span', 'tp-step-num', `#${idx + 1} · ${REL_RU[edge.relationType] || edge.relationType}`);
      const tBold = el('b', null, titleStr); tBold.style.cssText = 'font-size:13px;display:block;margin:2px 0';
      const metaLine = el('div', 'meta', [
        FORMAT_RU[node.format] || resolvedCat,
        node.startDate?.year || '',
        node.averageScore ? '★ ' + (node.averageScore / 10).toFixed(1) : '',
        matchedInCol ? `✓ В коллекции (${matchedInCol.status})` : ''
      ].filter(Boolean).join(' · '));
      metaLine.style.margin = '0';
      if (matchedInCol) metaLine.style.color = '#34d399';
      inf.append(stepBadge, tBold, metaLine);
      card.append(im, inf);
      card.onclick = () => {
        openFullTitlePage({
          aniId: node.id || 0, mal: node.idMal || 0, title: titleStr, en: node.title?.romaji || titleStr,
          romaji: node.title?.romaji || '', poster: isValidPosterUrl(node.coverImage?.large) ? node.coverImage.large : '',
          year: node.startDate?.year || '',
          ext: node.averageScore ? (node.averageScore / 10).toFixed(1) : '',
          format: node.format || '', category: resolvedCat, src: node.id ? 'AniList' : 'Shikimori', tags: []
        });
      };
      relGrid.append(card);
    });
  }
}

async function openCatalogByCreator(kindType, nameStr, itemCat) {
  if (!nameStr) return;
  applyMainTabView('catalog');
  cgGrid.replaceChildren(...Array.from({ length: 8 }, () => el('div', 'sk')));
  $('cgMore').style.display = 'none';
  if ($('cgHeroWrap')) $('cgHeroWrap').style.display = 'none';
  toast(`Ищу все работы: ${nameStr}…`);
  try {
    let found = [];
    const isAni = ['Аниме', 'Манга', 'Ранобэ'].includes(itemCat);
    if (isAni) {
      if (!isAniListBlockedNow()) {
        try {
          if (kindType === 'studio') {
            const q = 'query($s:String){Studio(search:$s){name media(sort:POPULARITY_DESC,perPage:24){nodes{id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year} averageScore episodes duration chapters volumes genres status source}}}}';
            const j = await fetchAniListGraphQL(q, { s: nameStr }, 2800);
            const nodes = j?.data?.Studio?.media?.nodes || [];
            found = nodes.map(m => ({ ...mapAniListMediaNode(m, m.format === 'NOVEL' || m.format === 'MANGA' || m.format === 'ONE_SHOT' ? 'MANGA' : 'ANIME'), studio: nameStr, author: '' }));
          } else {
            const q = 'query($s:String){Staff(search:$s){name{full} staffMedia(sort:POPULARITY_DESC,perPage:24){nodes{id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year} averageScore episodes duration chapters volumes genres status source}}}}';
            const j = await fetchAniListGraphQL(q, { s: nameStr }, 2800);
            const nodes = j?.data?.Staff?.staffMedia?.nodes || [];
            found = nodes.map(m => ({ ...mapAniListMediaNode(m, m.format === 'NOVEL' || m.format === 'MANGA' || m.format === 'ONE_SHOT' ? 'MANGA' : 'ANIME'), author: nameStr, studio: '' }));
          }
        } catch (aniErr) {
          found = [];
        }
      }
      if (!found.length) {
        if (kindType === 'studio') {
          try {
            const stRes = await shiki(`/api/studios?search=${encodeURIComponent(nameStr)}`);
            const stId = Array.isArray(stRes) && stRes[0]?.id;
            if (stId) {
              const g = await shikiGraphQL(
                'query($st:String){animes(studio:$st,limit:24,order:popularity){id malId name russian english japanese synonyms kind status score airedOn{year} isCensored genres{id name russian} description poster{originalUrl mainUrl} episodes duration origin studios{name} videos{url kind}}}',
                { st: String(stId) }
              );
              found = (g?.animes || []).map(d => mapShikimoriGraphQLNode(d, 'ANIME', false));
            }
          } catch (e) {}
        }
        if (!found.length) {
          const mType = itemCat === 'Аниме' ? 'ANIME' : 'MANGA';
          found = await _shikiCatalogFallback(nameStr, mType, { per: 24, format: itemCat === 'Ранобэ' ? 'NOVEL' : undefined }).catch(() => []);
        }
      }
    } else {
      const k = getActiveTmdbKey();
      if (kindType === 'studio') {
        const cj = await fetchTmdbJson(`https://api.themoviedb.org/3/search/company?api_key=${encodeURIComponent(k)}&query=${encodeURIComponent(nameStr)}`, 6000);
        const cid = cj?.results?.[0]?.id;
        if (cid) found = await tmdb(null, `/discover/movie?with_companies=${cid}&sort_by=popularity.desc`, 'movie', 1);
      } else {
        const pj = await fetchTmdbJson(`https://api.themoviedb.org/3/search/person?api_key=${encodeURIComponent(k)}&language=ru-RU&query=${encodeURIComponent(nameStr)}`, 6000);
        const pid = pj?.results?.[0]?.id;
        if (pid) {
          const cr = await fetchTmdbJson(`https://api.themoviedb.org/3/person/${pid}/combined_credits?api_key=${encodeURIComponent(k)}&language=ru-RU`, 6000);
          found = [...(cr.crew || []), ...(cr.cast || [])].filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 24).map(x => ({
            title: x.title || x.name, en: x.original_title || x.original_name || '', orig: x.original_title || x.original_name || '', alt: '',
            poster: x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '',
            year: (x.release_date || x.first_air_date || '').slice(0, 4),
            ext: x.vote_count ? x.vote_average.toFixed(1) : '', tags: (x.genre_ids || []).map(g => TG[g]).filter(Boolean),
            tmdb: x.media_type + '/' + x.id, src: 'TMDB', url: 'https://www.themoviedb.org/' + x.media_type + '/' + x.id,
            desc: x.overview || '', category: x.media_type === 'tv' ? 'Сериал' : 'Фильм'
          }));
        }
      }
    }
    cgGrid.replaceChildren();
    if (!found.length) {
      cgGrid.append(el('div', 'msg', `Работы для «${nameStr}» не найдены.`));
      return;
    }
    if ($('cgSourceCaption')) $('cgSourceCaption').textContent = `🔎 Работы ${kindType === 'studio' ? 'студии' : 'автора/режиссёра'}: ${nameStr} (${found.length})`;
    found.forEach(cgCard);
    cgMarks();
    ruCards();
  } catch (e) {
    cgGrid.replaceChildren(el('div', 'msg', 'Не удалось загрузить работы: ' + e.message));
  }
}

if ($('openFullPageFromDetailBtn')) $('openFullPageFromDetailBtn').onclick = () => { const it = items.find(x => x.id === curId); if (it) openFullTitlePage(it); };
if ($('openFullPageFromRndBtn')) $('openFullPageFromRndBtn').onclick = () => { if (rndR) openFullTitlePage(rndR); };

// ---------- Управление аккаунтом и диагностика облака (режим одного пользователя) ----------
async function wipeAllUserDataFromFirestore(targetUid) {
  if (!targetUid || !auth.currentUser) return 0;
  const docIds = new Set(['prof_' + targetUid, 'prof_rucache_' + targetUid]);
  try {
    const s = await getDocs(query(collection(db, 'items'), where('userId', '==', targetUid)));
    s.docs.forEach(d => docIds.add(d.id));
  } catch (e) {}
  const allIds = [...docIds];
  for (let i = 0; i < allIds.length; i += 350) {
    const b = writeBatch(db);
    allIds.slice(i, i + 350).forEach(id => b.delete(doc(db, 'items', id)));
    await track(b.commit());
  }
  return allIds.length;
}

async function purgeUserLocalCaches(uid) {
  const keys = [
    'items_' + uid,
    'prof_' + uid,
    'safetyBackup_' + uid,
    'lastImportMeta_' + uid,
    'linkAttemptsMap_' + uid,
    'uncertainMatchesCache_' + uid,
    'catalogLinkPending_' + uid,
    'cloudHadSynced_' + uid,
    'localMigrateDeclined_' + uid,
    'localMigrateDone_' + uid,
    'schemaMigratedV3_' + uid,
    'schemaMigratedV4_' + uid
  ];
  keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  await Promise.allSettled([
    idbVault.del('items_' + uid),
    idbVault.del('prof_' + uid),
    idbVault.del('safetyBackup_' + uid),
    idbVault.del('uncertainMatchesCache_' + uid)
  ]);
}

// ---------- Единый контроллер hover-списков (.cat-dd-wrap и др.) с задержкой закрытия 400 мс и поддержкой клика на смартфонах ----------
{
  const hoverTimers = new WeakMap();
  document.querySelectorAll('.pick-menu-wrap, .hyb-more-wrap, .toolbar-more-wrap').forEach(wrap => {
    wrap.addEventListener('mouseenter', () => {
      if (hoverTimers.has(wrap)) {
        clearTimeout(hoverTimers.get(wrap));
        hoverTimers.delete(wrap);
      }
      wrap.classList.add('hover-hold');
    });
    wrap.addEventListener('mouseleave', () => {
      const t = setTimeout(() => {
        wrap.classList.remove('hover-hold');
      }, 420);
      hoverTimers.set(wrap, t);
    });
  });

  // Делегированный обработчик для ВСЕХ .cat-dd-wrap (включая #colCatDropdownWrap, #animeKindFilters, #videoKindFilters, #kindFilters, #cgCatDropdownWrap, #cgSubKindDropdownWrap)
  document.addEventListener('mouseover', e => {
    const ddWrap = e.target.closest('.cat-dd-wrap');
    if (ddWrap) {
      if (hoverTimers.has(ddWrap)) {
        clearTimeout(hoverTimers.get(ddWrap));
        hoverTimers.delete(ddWrap);
      }
      document.querySelectorAll('.cat-dd-wrap.open').forEach(other => {
        if (other !== ddWrap && !other.dataset.pinned) {
          other.classList.remove('open', 'hover-hold');
        }
      });
      ddWrap.classList.add('open', 'hover-hold');
    }
  });

  document.addEventListener('mouseout', e => {
    const ddWrap = e.target.closest('.cat-dd-wrap');
    if (ddWrap && !ddWrap.contains(e.relatedTarget)) {
      if (hoverTimers.has(ddWrap)) clearTimeout(hoverTimers.get(ddWrap));
      const t = setTimeout(() => {
        ddWrap.classList.remove('hover-hold');
        if (!ddWrap.dataset.pinned) ddWrap.classList.remove('open');
      }, 400);
      hoverTimers.set(ddWrap, t);
    }
  });

  document.addEventListener('click', e => {
    const ddBtn = e.target.closest('.cat-dd-btn');
    if (ddBtn) {
      const ddWrap = ddBtn.closest('.cat-dd-wrap');
      if (ddWrap && !['cgCatDropdownWrap', 'cgSubKindDropdownWrap', 'colCatDropdownWrap'].includes(ddWrap.id)) {
        e.stopPropagation();
        const isPinned = ddWrap.dataset.pinned === '1';
        document.querySelectorAll('.cat-dd-wrap').forEach(other => {
          if (other !== ddWrap) {
            delete other.dataset.pinned;
            other.classList.remove('open', 'hover-hold');
          }
        });
        if (isPinned) {
          delete ddWrap.dataset.pinned;
          ddWrap.classList.remove('open', 'hover-hold');
        } else {
          ddWrap.dataset.pinned = '1';
          ddWrap.classList.add('open');
        }
        return;
      }
    }
    document.querySelectorAll('.cat-dd-wrap').forEach(w => {
      if (!w.contains(e.target)) {
        delete w.dataset.pinned;
        w.classList.remove('open', 'hover-hold');
      }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.cat-dd-wrap').forEach(w => {
        delete w.dataset.pinned;
        w.classList.remove('open', 'hover-hold');
      });
    }
  });
}

// ---------- Кнопка «🪪 Скачать PNG-визитку» в меню «Ещё ▾» профиля ----------
async function downloadProfilePngBusinessCard() {
  $('hybMorePop')?.classList.remove('open');
  toast('🎨 Рисую PNG-визитку профиля…');
  try {
    const W = 1200, H = 768;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const rRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const loadImgSafe = src => new Promise(res => {
      if (!src || src === FALL) return res(null);
      const im = new Image();
      if (!src.startsWith('data:')) im.crossOrigin = 'anonymous';
      const timer = setTimeout(() => res(null), 3500);
      im.onload = () => { clearTimeout(timer); res(im); };
      im.onerror = () => { clearTimeout(timer); res(null); };
      im.src = safePosterUrl(src);
    });

    // 1. Фон карточки
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, W, H);

    // 2. Шапка-обложка (210px)
    const bannerH = 210;
    const activeProf = prof;
    const coverImg = await loadImgSafe(activeProf.cover);
    ctx.save();
    rRect(24, 24, W - 48, bannerH, 18);
    ctx.clip();
    if (coverImg) {
      const k = Math.max((W - 48) / coverImg.width, bannerH / coverImg.height);
      const dw = coverImg.width * k, dh = coverImg.height * k;
      ctx.drawImage(coverImg, 24 + (W - 48 - dw) / 2, 24 + (bannerH - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(24, 24, W - 24, 24 + bannerH);
      g.addColorStop(0, '#312e81');
      g.addColorStop(0.5, '#5c6ac4');
      g.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = g;
      ctx.fillRect(24, 24, W - 48, bannerH);
    }
    const vig = ctx.createLinearGradient(0, 24, 0, 24 + bannerH);
    vig.addColorStop(0, 'rgba(15,17,21,0.15)');
    vig.addColorStop(1, 'rgba(15,17,21,0.88)');
    ctx.fillStyle = vig;
    ctx.fillRect(24, 24, W - 48, bannerH);
    ctx.restore();

    // 3. Круглый аватар
    const avX = 64, avY = 148, avR = 62;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + avR, avY + avR, avR + 5, 0, Math.PI * 2);
    ctx.fillStyle = '#161920';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = activeProf.customColor || '#5c6ac4';
    ctx.stroke();
    ctx.restore();

    const avSrc = activeProf.avatar || (user && user.photoURL) || '';
    const avImg = await loadImgSafe(avSrc);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
    ctx.clip();
    if (avImg) {
      const k = Math.max((avR * 2) / avImg.width, (avR * 2) / avImg.height);
      const dw = avImg.width * k, dh = avImg.height * k;
      ctx.drawImage(avImg, avX + avR - dw / 2, avY + avR - dh / 2, dw, dh);
    } else {
      ctx.fillStyle = '#1c2029';
      ctx.fillRect(avX, avY, avR * 2, avR * 2);
    }
    ctx.restore();

    // 4. Имя, дата и статистика времени
    const vis = getVisibleItems().filter(i => !i.archived);
    const completed = vis.filter(isCompletedItem);
    const totalWatchMins = completed.filter(i => i.category === 'Аниме' || KINO.includes(i.category)).reduce((s, i) => s + getItemMinutes(i), 0);
    const totalEps = completed.filter(i => i.category === 'Аниме' || i.category === 'Сериал').reduce((s, i) => s + getItemEpisodesCount(i), 0);
    const favCount = vis.filter(i => i.fav).length;
    const ratedCount = vis.filter(i => num(i.rating) > 0).length;

    const nick = activeProf.name || (user && user.displayName) || 'Моя коллекция';
    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
    ctx.fillText(nick.slice(0, 28), 210, 205);

    const regDate = new Date(activeProf.createdAt || Date.now());
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Коллекция с ${regDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}  •  Всего тайтлов: ${vis.length}`, 210, 232);

    // Большой блок времени справа
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7c89e8';
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    ctx.fillText(formatWatchTimeRu(totalWatchMins), W - 54, 198);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${totalEps.toLocaleString('ru-RU')} серий  •  ❤ ${favCount} в любимом  •  ★ ${ratedCount} оценок`, W - 54, 226);
    ctx.textAlign = 'left';

    // 5. Пять карточек статусов
    const stCards = [
      ['Смотрю', vis.filter(i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю').length, '#10b981'],
      ['Просмотрено', vis.filter(i => i.status === 'Просмотрено/Прочитано').length, '#38bdf8'],
      ['В планах', vis.filter(i => i.status === 'В планах').length, '#a855f7'],
      ['Любимое', favCount, '#ec4899'],
      ['Брошено', vis.filter(i => i.status === 'Брошено').length, '#ef4444']
    ];
    const cardW = (W - 48 - 48) / 5;
    stCards.forEach(([lbl, cnt, col], idx) => {
      const cx = 24 + idx * (cardW + 12), cy = 290;
      rRect(cx, cy, cardW, 92, 12);
      ctx.fillStyle = '#161920';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + 22, cy + 30, 6, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      ctx.fillStyle = '#d1d5db';
      ctx.font = '600 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(lbl, cx + 36, cy + 35);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(String(cnt), cx + 18, cy + 72);
    });

    // 5б. Блок статистики по 4 категориям (как в Профиле)
    const TYPE_DEFS = [
      ['Аниме', 'Аниме', false, '#7c89e8'],
      ['Кино и сериалы', 'Фильмы и сериалы', false, '#38bdf8'],
      ['Манга', 'Манга', true, '#f59e0b'],
      ['Ранобэ', 'Ранобэ', true, '#10b981']
    ];
    const catCardW = (W - 48 - 36) / 4;
    TYPE_DEFS.forEach(([catKey, titleLbl, isRead, accentCol], idx) => {
      const allOfType = vis.filter(i => catKey === 'Кино и сериалы' ? KINO.includes(i.category) : i.category === catKey);
      const doneOfType = allOfType.filter(isCompletedItem);
      const cx = 24 + idx * (catCardW + 12), cy = 402;
      rRect(cx, cy, catCardW, 96, 12);
      ctx.fillStyle = '#161920';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();

      ctx.fillStyle = '#f3f4f6';
      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(titleLbl, cx + 16, cy + 32);

      const badgeTxt = String(allOfType.length);
      ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
      const badgeW = Math.max(32, ctx.measureText(badgeTxt).width + 18);
      rRect(cx + catCardW - badgeW - 14, cy + 14, badgeW, 24, 12);
      ctx.fillStyle = 'rgba(124,137,232,0.18)';
      ctx.fill();
      ctx.fillStyle = accentCol;
      ctx.textAlign = 'center';
      ctx.fillText(badgeTxt, cx + catCardW - badgeW / 2 - 14, cy + 31);
      ctx.textAlign = 'left';

      let line1 = '';
      let line2 = '';
      if (isRead) {
        const ch = doneOfType.reduce((s, i) => s + num(i.eps), 0);
        const vl = doneOfType.reduce((s, i) => s + num(i.vols), 0);
        line1 = `Прочитано: ${doneOfType.length}`;
        line2 = [ch ? `${ch.toLocaleString('ru-RU')} гл.` : '', vl ? `${vl.toLocaleString('ru-RU')} т.` : ''].filter(Boolean).join(' · ') || '—';
      } else {
        const eps = doneOfType.filter(i => i.category === 'Аниме' || i.category === 'Сериал').reduce((s, i) => s + getItemEpisodesCount(i), 0);
        const mins = doneOfType.reduce((s, i) => s + getItemMinutes(i), 0);
        line1 = `Просмотрено: ${doneOfType.length}`;
        line2 = [eps ? `${eps.toLocaleString('ru-RU')} сер.` : '', mins > 0 ? formatWatchTimeRu(mins) : ''].filter(Boolean).join(' · ') || '—';
      }
      ctx.fillStyle = '#9ca3af';
      ctx.font = '500 13.5px system-ui, -apple-system, sans-serif';
      ctx.fillText(line1, cx + 16, cy + 60);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 13.5px system-ui, -apple-system, sans-serif';
      ctx.fillText(line2, cx + 16, cy + 81);
    });

    // 6. Нижний ряд: Любимые жанры (слева) и Топ тайтлов коллекции (справа)
    rRect(24, 518, 460, 224, 14);
    ctx.fillStyle = '#161920';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Любимые жанры', 44, 552);

    const topGenres = topBy(i => i.tags || []).slice(0, 5);
    if (!topGenres.length) {
      ctx.fillStyle = '#8b92a5';
      ctx.font = '15px system-ui, -apple-system, sans-serif';
      ctx.fillText('Жанры появятся после добавления тайтлов', 44, 590);
    } else {
      topGenres.forEach(([gName, gCnt], idx) => {
        const gy = 584 + idx * 29;
        ctx.fillStyle = '#d1d5db';
        ctx.font = '500 15px system-ui, -apple-system, sans-serif';
        ctx.fillText(gName.slice(0, 26), 44, gy);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#7c89e8';
        ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${gCnt} шт.`, 464, gy);
        ctx.textAlign = 'left';
      });
    }

    rRect(502, 518, W - 526, 224, 14);
    ctx.fillStyle = '#161920';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Избранные и лучшие тайтлы коллекции', 524, 552);

    const bestItems = vis
      .slice()
      .sort((a, b) => (Number(b.fav) - Number(a.fav)) || (num(b.rating) - num(a.rating)) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
      .slice(0, 5);
    bestItems.forEach((it, idx) => {
      const ty = 584 + idx * 29;
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '500 15px system-ui, -apple-system, sans-serif';
      const titleClean = (it.fav ? '❤ ' : '') + it.title;
      ctx.fillText(titleClean.slice(0, 44), 524, ty);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
      ctx.fillText(it.rating ? `★ ${it.rating}` : (it.extRating ? `★ ${it.extRating}` : it.status.split('/')[0]), W - 46, ty);
      ctx.textAlign = 'left';
    });

    const dataUrl = canvas.toDataURL('image/png');
    const fileName = `Kiroku_Card_${nick.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, '_') || 'Profile'}.png`;
    const shouldDownload = await dlgOpen(() => {
      $('dlgTitle').textContent = '🪪 Предпросмотр PNG-визитки профиля';
      $('dlgText').textContent = 'Так выглядит твоя визитка. Нажми на картинку, чтобы увеличить, или кнопку «Скачать PNG», чтобы сохранить файл:';
      const body = $('dlgBody');
      body.replaceChildren();
      const prevImg = el('img');
      prevImg.src = dataUrl;
      prevImg.alt = 'PNG-визитка профиля';
      prevImg.style.cssText = 'width:100%;height:auto;border-radius:12px;border:1px solid var(--bd);box-shadow:0 8px 28px rgba(0,0,0,.55);cursor:zoom-in';
      prevImg.onclick = () => openPosterLightbox(dataUrl, `PNG-визитка: ${nick}`);
      body.append(prevImg);
    }, '⬇ Скачать PNG', false, () => true);

    if (shouldDownload) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      a.click();
      toast('PNG-визитка профиля сохранена! 🪪');
    }
  } catch (err) {
    toast('Не удалось создать PNG-визитку: ' + err.message, true);
  }
}
if ($('downloadPngCardBtn')) $('downloadPngCardBtn').onclick = downloadProfilePngBusinessCard;

// ---------- Полноэкранное открытие постеров и фото по клику (в маленьком окне тайтла и на полной странице) ----------
function getHighResPosterUrl(src) {
  if (!src || src === FALL) return FALL;
  // Для TMDB автоматически подгружаем более высокое разрешение при открытии постера
  return String(src).replace('/w342/', '/w780/').replace('/w185/', '/w500/');
}

function openPosterLightbox(src, titleText = '') {
  if (!src || src === FALL) return toast('У этого тайтла пока нет постера');
  const modal = $('posterLightboxModal');
  const img = $('posterLightboxImg');
  const ttl = $('posterLightboxTitle');
  const lnk = $('posterLightboxOrigLink');
  if (!modal || !img) return;
  const hiRes = getHighResPosterUrl(src);
  delete img.dataset.posterStep;
  delete img.dataset.posterFailed;
  delete img.dataset.rawPoster;
  img.onerror = () => {
    if (img.src !== src && src && src !== FALL) {
      img.onerror = () => handlePosterImgError(img, src, null);
      img.src = src;
    } else {
      handlePosterImgError(img, src, null);
    }
  };
  img.src = hiRes;
  if (ttl) ttl.textContent = titleText || 'Постер';
  if (lnk) {
    lnk.href = hiRes;
    lnk.style.display = hiRes.startsWith('data:') ? 'none' : '';
  }
  modal.classList.add('open');
}

function closePosterLightbox() {
  $('posterLightboxModal')?.classList.remove('open');
}

if ($('posterLightboxModal')) {
  $('posterLightboxModal').onclick = e => {
    if (e.target === $('posterLightboxCloseBtn')) {
      closePosterLightbox();
    } else if (e.target === $('posterLightboxModal') && _lastMouseDownTarget === $('posterLightboxModal')) {
      closePosterLightbox();
    }
  };
}
if ($('posterLightboxCloseBtn')) $('posterLightboxCloseBtn').onclick = closePosterLightbox;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('posterLightboxModal')?.classList.contains('open')) {
    closePosterLightbox();
  }
});

// Делегированный обработчик клика по постерам в маленьких окнах (#detailPoster, #rndPoster, #charPopPoster, #posterPreview) и на полной странице (.tp-poster)
document.addEventListener('click', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.id === 'detailPoster') {
    e.stopPropagation();
    openPosterLightbox(t.src, $('detailTitle')?.textContent || 'Постер');
  } else if (t.id === 'rndPoster') {
    e.stopPropagation();
    openPosterLightbox(t.src, $('rndTitle')?.textContent || 'Постер');
  } else if (t.classList.contains('tp-poster')) {
    e.stopPropagation();
    const h1 = document.querySelector('#titlePageView h1')?.textContent || 'Постер';
    openPosterLightbox(t.src, h1);
  } else if (t.id === 'charPopPoster') {
    e.stopPropagation();
    openPosterLightbox(t.src, $('charPopRuName')?.textContent || 'Персонаж');
  } else if (t.id === 'posterPreview' && t.src && t.src !== FALL) {
    e.stopPropagation();
    openPosterLightbox(t.src, $('inputTitle')?.value || 'Предпросмотр постера');
  }
});


// ---------- Удаление профиля строго по реальной реавторизации (Google / пароль) ----------
if ($('deleteMyAccountBtn')) {
  $('deleteMyAccountBtn').onclick = async () => {
    if (!user) return;
    if (!(await uiConfirm('Удалить профиль и коллекцию?\n\nЧто делает эта кнопка: безвозвратно удаляет все твои тайтлы и настройки профиля из облака и этого браузера (для облачного профиля потребуется подтверждение личности).', 'Подтвердить', true))) return;
    if (user.isLocal) {
      await purgeUserLocalCaches('local_user');
      try { localStorage.removeItem('localItems'); localStorage.removeItem('prof'); } catch (e) {}
      await idbVault.del('localItems');
      await idbVault.del('prof');
      items = [];
      resetProfObjectToDefault();
      closeAll();
      refresh();
      toast('Локальные данные полностью удалены.');
      return;
    }

    const userEmail = (auth.currentUser?.email || user.email || '').trim();
    const providers = (auth.currentUser?.providerData || []).map(p => p.providerId);
    const hasGoogle = providers.includes('google.com');
    const hasPassword = providers.includes('password');

    let emailInputEl = null, passInputEl = null, googleReauthed = false;
    const confirmed = await dlgOpen(() => {
      $('dlgTitle').textContent = '⚠ Удаление аккаунта (требуется реавторизация)';
      $('dlgText').textContent = `Для защиты твоей коллекции (${items.length} тайтлов) подтверди личность через Google или текущий пароль от аккаунта ${userEmail}:`;
      const body = $('dlgBody');
      body.replaceChildren();

      if (hasGoogle) {
        const googleReauthBtn = el('button', 'btn btn-s', '🔐 Подтвердить вход через Google');
        googleReauthBtn.type = 'button';
        googleReauthBtn.style.cssText = 'width:100%;font-size:13px;padding:9px 12px';
        googleReauthBtn.onclick = async () => {
          try {
            const freshProvider = new GoogleAuthProvider();
            freshProvider.setCustomParameters({ prompt: 'select_account', login_hint: userEmail });
            await reauthenticateWithPopup(auth.currentUser, freshProvider);
            googleReauthed = true;
            googleReauthBtn.textContent = '✓ Личность подтверждена через Google';
            googleReauthBtn.disabled = true;
            toast('Реавторизация через Google выполнена!');
          } catch (e) {
            if (e.code !== 'auth/popup-closed-by-user') toast('Не удалось подтвердить через Google: ' + (e.message || e.code), true);
          }
        };
        body.append(googleReauthBtn);
      }

      emailInputEl = el('input');
      emailInputEl.type = 'email';
      emailInputEl.placeholder = `Введи свою почту (${userEmail}) для подтверждения`;
      body.append(emailInputEl);

      if (hasPassword) {
        passInputEl = el('input');
        passInputEl.type = 'password';
        passInputEl.placeholder = 'Введи текущий пароль от аккаунта (обязательно)';
        body.append(passInputEl);
      }
    }, 'Удалить профиль навсегда', true, () => ({
      typedEmail: (emailInputEl?.value || '').trim(),
      typedPass: (passInputEl?.value || '').trim()
    }));

    if (!confirmed) return;
    if (!userEmail || confirmed.typedEmail.toLowerCase() !== userEmail.toLowerCase()) {
      return toast(`Отменено: нужно точно ввести адрес своей почты (${userEmail})`, true);
    }

    try {
      let reauthenticated = googleReauthed;
      if (!reauthenticated && hasPassword) {
        if (!confirmed.typedPass) {
          return toast('Введи текущий пароль от аккаунта для подтверждения удаления.', true);
        }
        const cred = EmailAuthProvider.credential(userEmail, confirmed.typedPass);
        await reauthenticateWithCredential(auth.currentUser, cred);
        reauthenticated = true;
      }
      if (!reauthenticated) {
        return toast('Сначала подтверди вход через кнопку Google или введи текущий пароль.', true);
      }

      toast('Очищаю все данные профиля и коллекции в облаке…');
      const uid = user.uid;
      window._explicitEmptyAllowed = true;
      await wipeAllUserDataFromFirestore(uid);
      await purgeUserLocalCaches(uid);
      closeAll();
      await deleteUser(auth.currentUser);
      toast('Твой аккаунт и все данные полностью удалены.');
    } catch (e) {
      toast('Ошибка реавторизации или удаления аккаунта: ' + (e.code || e.message), true);
    }
  };
}

// Кнопка «🩺 Проверка облака» (runCloudDiagnostics) в окне «Данные»
async function runCloudDiagnostics() {
  const box = $('cloudDiagResultBox');
  if (!box) return;
  box.style.display = 'block';
  if (!user || user.isLocal || !auth.currentUser) {
    box.replaceChildren(el('div', 'diag-err', '⚠ Ты сейчас в локальном режиме. Войди в облачный аккаунт (Google или Почта), чтобы проверить правила Firestore.'));
    return;
  }

  box.replaceChildren(el('div', 'meta', '🩺 Выполняю проверку правил Firestore и парсеров импорта…'));
  const rows = [];
  const runStep = async (label, fn) => {
    try {
      const detail = await fn();
      rows.push({ label, ok: true, detail: detail || 'ОК' });
    } catch (e) {
      rows.push({ label, ok: false, detail: (e.code ? `[${e.code}] ` : '') + (e.message || 'Отклонено') });
    }
  };

  const uid = user.uid;
  const now = Date.now();

  await runStep('1. Загрузка своей коллекции (kind=="title" && userId==uid)', async () => {
    const s1 = await getDocs(query(collection(db, 'items'), where('kind', '==', 'title'), where('userId', '==', uid), limit(5)));
    return `ОК (прочитано тайтлов: ${s1.docs.length})`;
  });

  await runStep('2. Запись и удаление тестового тайтла', async () => {
    const tmpId = `${uid}_diag_${now}`;
    await setDoc(doc(db, 'items', tmpId), {
      id: now,
      _docId: tmpId,
      kind: 'title',
      userId: uid,
      title: '__diag_test__',
      category: 'Фильм',
      status: 'В планах',
      updatedAt: now
    });
    await deleteDoc(doc(db, 'items', tmpId));
    return 'ОК (создан и удалён)';
  });

  await runStep('3. Запись и чтение документа профиля (prof_' + uid.slice(0, 6) + '…)', async () => {
    await setDoc(doc(db, 'items', 'prof_' + uid), {
      kind: 'profile',
      isProfile: true,
      userId: uid,
      lastVisit: Date.now()
    }, { merge: true });
    profCloud(false);
    return 'ОК (профиль синхронизирован)';
  });

  await runStep('4. Самопроверка парсеров (CSV/TSV/HTML/JSON/TXT/IMDb)', async () => {
    const pRes = runParserSelfTests();
    const okCnt = pRes.filter(x => x.ok).length;
    if (okCnt !== pRes.length) throw new Error(`Прошло ${okCnt} из ${pRes.length}`);
    return `ОК (${okCnt}/${pRes.length} форматов пройдено)`;
  });

  const tbl = el('table', 'diag-table');
  const thead = el('thead'), trH = el('tr');
  ['Проверка', 'Статус', 'Результат'].forEach(h => trH.append(el('th', null, h)));
  thead.append(trH);
  const tbody = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    tr.append(
      el('td', null, r.label),
      el('td', r.ok ? 'diag-ok' : 'diag-err', r.ok ? '✓ ОК' : '✕ Ошибка'),
      el('td', null, r.detail)
    );
    tbody.append(tr);
  });
  tbl.append(thead, tbody);
  box.replaceChildren(tbl);
}
if ($('cloudDiagBtn')) $('cloudDiagBtn').onclick = runCloudDiagnostics;
if ($('manualCloudSyncBtn')) {
  $('manualCloudSyncBtn').onclick = async () => {
    if (typeof window.forceCloudSyncNow === 'function') {
      await window.forceCloudSyncNow(true);
    }
  };
}
if ($('manualLocalMigrateBtn')) {
  $('manualLocalMigrateBtn').onclick = async () => {
    if (!(await uiConfirm('Перенести локальную коллекцию в облако?\n\nЧто делает эта кнопка: проверяет записи, созданные в локальном режиме этого браузера, и переносит недостающие тайтлы в твой облачный аккаунт без удаления текущих данных.', 'Подтвердить'))) return;
    await checkMigrateLocalItemsToCloud(true);
  };
}
if ($('runSchemaMigrationBtn')) $('runSchemaMigrationBtn').onclick = () => migrateOldDocsToKindSchema(true);

// ---------- В1. Индивидуальные значки за аниме (до 3 надетых одновременно + неоновая рамка для оценки 10!), В3. Капсула времени по дате просмотра, В4. Импорт Shikimori/AniList/MAL (аниме + манга + 1000+ записей + русские названия) ----------



// В4. Онлайн-импорт Аниме и Манги с AniList / Shikimori через единую воронку предпросмотра (с поддержкой «Отменить этот импорт» и разбора!)
if ($('shikiImportBtn')) {
  $('shikiImportBtn').onclick = () => {
    $('hybMorePop')?.classList.remove('open');
    hideModalElement('dataModal');
    let iNick, iPlatform;
    dlgOpen(() => {
      $('dlgTitle').textContent = '⚡ Импорт из Shikimori / AniList / MyAnimeList';
      $('dlgText').textContent = 'Введи свой никнейм для переноса аниме и манги (с предпросмотром, проверкой повторов и сохранением дат) или выбери XML/JSON-файл экспорта:';
      const sel = el('select');
      sel.add(new Option('🅰 AniList — Аниме + Манга (по никнейму, работает без VPN)', 'anilist'));
      sel.add(new Option('🌸 Shikimori — Аниме + Манга (по никнейму, до 1000+ тайтлов)', 'shiki'));
      const inp = el('input'); inp.placeholder = 'Твой никнейм на выбранном сайте';
      const fileBtn = el('button', 'btn btn-s', '📂 Или выбрать XML / JSON файл экспорта (MAL / Shikimori)');
      fileBtn.type = 'button';
      fileBtn.onclick = () => { closeAll(); $('malXmlFile').click(); };
      iPlatform = sel; iNick = inp;
      $('dlgBody').replaceChildren(sel, inp, fileBtn);
    }, 'Загрузить для предпросмотра', false, () => ({ p: iPlatform.value, n: iNick.value.trim() })).then(async res => {
      if (!res || !res.n) return;
      toast(`Подключаюсь к ${res.p === 'shiki' ? 'Shikimori' : 'AniList'} (${res.n})…`);
      try {
        const candidates = [];
        if (res.p === 'anilist') {
          const ST_MAP = { COMPLETED: 'Просмотрено/Прочитано', CURRENT: 'Смотрю/Читаю', PLANNING: 'В планах', DROPPED: 'Брошено', PAUSED: 'В планах', REPEATING: 'Пересматриваю' };
          for (const mediaType of ['ANIME', 'MANGA']) {
            const q = `query($u:String,$t:MediaType){MediaListCollection(userName:$u,type:$t){lists{entries{status score(format:POINT_10) repeat updatedAt completedAt{year month day} media{id idMal isAdult countryOfOrigin format duration episodes volumes chapters startDate{year} averageScore genres coverImage{large} title{romaji english}}}}}}`;
            const j = await fetchAniListGraphQL(q, { u: res.n, t: mediaType }, 6000);
            const lists = j?.data?.MediaListCollection?.lists || [];
            const entries = lists.flatMap(l => l.entries || []);
            const mals = [...new Set(entries.map(e => e.media?.idMal).filter(Boolean))];
            const ruMap = {};
            for (let i = 0; i < mals.length; i += 50) {
              try { Object.assign(ruMap, await ruTitles(mediaType === 'ANIME' ? 'animes' : 'mangas', mals.slice(i, i + 50))); } catch (e) {}
            }
            entries.forEach(e => {
              const m = e.media; if (!m) return;
              const enTitle = m.title?.english || m.title?.romaji || 'Тайтл';
              const ruTitle = ruMap[m.idMal] || enTitle;
              const catName = mediaType === 'ANIME' ? 'Аниме' : (m.format === 'NOVEL' ? 'Ранобэ' : 'Манга');
              const subK = catName === 'Манга' ? ({KR: 'Манхва', CN: 'Маньхуа', TW: 'Маньхуа', JP: 'Манга'}[m.countryOfOrigin] || 'Манга') : '';
              const knownSt = ST_MAP[e.status] || '';
              const status = knownSt || 'В планах';
              const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';
              const compDate = isDone ? ((e.completedAt?.year) ? new Date(e.completedAt.year, (e.completedAt.month || 1) - 1, e.completedAt.day || 1).getTime() : 0) : 0;
              candidates.push(fix({
                aniId: m.id, mal: m.idMal || 0, isAdult: Boolean(m.isAdult),
                title: ruTitle, titleEn: enTitle, romaji: m.title?.romaji || '', category: catName, subKind: subK,
                format: m.format || '', status,
                needsReview: Boolean(!knownSt),
                rating: e.score ? String(e.score) : '', extRating: m.averageScore ? (m.averageScore / 10).toFixed(1) : '',
                extSrc: 'AniList', poster: isValidPosterUrl(m.coverImage?.large) ? m.coverImage.large : '', year: m.startDate?.year || '',
                eps: (mediaType === 'ANIME' ? m.episodes : m.chapters) || 0, vols: m.volumes || 0, dur: m.duration || 0,
                rewatchCount: e.repeat || 0, completedAt: compDate,
                tags: (m.genres || []).map(g => RU[g] || g)
              }));
            });
          }
          await previewAndExecuteImport(candidates, `AniList (${res.n})`, `anilist_${res.n}_${candidates.length}`, false, null);
        } else {
          const uInfo = await shiki(`/api/users/${encodeURIComponent(res.n)}?is_nickname=1`);
          if (!uInfo || !uInfo.id) throw new Error('пользователь Shikimori не найден');
          const ST_SHIKI = { completed: 'Просмотрено/Прочитано', watching: 'Смотрю/Читаю', planned: 'В планах', dropped: 'Брошено', on_hold: 'В планах', rewatching: 'Пересматриваю' };
          for (const [targetType, apiKind, catName] of [['Anime', 'animes', 'Аниме'], ['Manga', 'mangas', 'Манга']]) {
            let rates = [];
            for (let page = 1; page <= 10; page++) {
              const pageRates = await shiki(`/api/v2/user_rates?user_id=${uInfo.id}&target_type=${targetType}&limit=1000&page=${page}`);
              if (!Array.isArray(pageRates) || !pageRates.length) break;
              rates = rates.concat(pageRates);
              if (pageRates.length < 1000) break;
            }
            const mals = [...new Set(rates.map(r => r.target_id).filter(Boolean))];
            const detMap = new Map();
            const isAn = targetType === 'Anime';
            const extraGql = isAn ? 'episodes duration' : 'chapters volumes';
            const gqlDet = `query($ids:String,$limit:PositiveInt){${apiKind}(ids:$ids,limit:$limit){id malId name russian english kind status score airedOn{year} releasedOn{year} genres{name russian} poster{originalUrl mainUrl} ${extraGql}}}`;
            for (let i = 0; i < mals.length; i += 50) {
              const slice = mals.slice(i, i + 50);
              let gotGql = false;
              try {
                const gRes = await shikiGraphQL(gqlDet, { ids: slice.join(','), limit: slice.length });
                const list = gRes?.[apiKind] || [];
                if (list.length) {
                  gotGql = true;
                  list.forEach(x => {
                    const mid = Number(x.malId || x.id);
                    if (mid) detMap.set(mid, x);
                  });
                }
              } catch (e) {}
              if (!gotGql) {
                const chunk = await shiki(`/api/${apiKind}?ids=${slice.join(',')}&limit=50`).catch(() => []);
                (chunk || []).forEach(x => { if (x?.id) detMap.set(Number(x.id), x); });
              }
            }
            rates.forEach(r => {
              const d = detMap.get(Number(r.target_id)); if (!d) return;
              const title = d.russian || d.english || d.name;
              const resolvedCat = (catName === 'Манга' && (d.kind === 'light_novel' || d.kind === 'novel')) ? 'Ранобэ' : catName;
              const subK = resolvedCat === 'Манга' ? (d.kind === 'manhwa' ? 'Манхва' : d.kind === 'manhua' ? 'Маньхуа' : 'Манга') : '';
              const knownSt = ST_SHIKI[r.status] || '';
              const status = knownSt || 'В планах';
              const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';
              const compTs = (isDone && r.updated_at) ? new Date(r.updated_at).getTime() : 0;
              const posterUrl = d.poster
                ? pickShikiGraphQLPoster(d.poster)
                : (d.image?.original && isValidPosterUrl(d.image.original) ? 'https://shikimori.io' + d.image.original : '');
              const yearVal = d.airedOn?.year || d.releasedOn?.year || (d.aired_on || '').slice(0, 4) || '';
              candidates.push(fix({
                mal: Number(d.malId || d.id),
                title,
                titleEn: d.english || d.name || '',
                romaji: d.name || '',
                category: resolvedCat,
                subKind: subK,
                status,
                needsReview: Boolean(!knownSt),
                rating: r.score ? String(r.score) : '',
                extRating: d.score ? String(d.score) : '',
                extSrc: 'Shikimori',
                poster: posterUrl,
                year: yearVal ? String(yearVal) : '',
                eps: (isAn ? (d.episodes || r.episodes) : (d.chapters || r.chapters)) || 0,
                vols: d.volumes || r.volumes || 0,
                dur: Number(d.duration) || (isAn ? 24 : 0),
                rewatchCount: r.rewatches || 0,
                completedAt: compTs,
                tags: Array.isArray(d.genres) ? d.genres.map(g => g.russian || g.name).filter(Boolean) : []
              }));
            });
          }
          await previewAndExecuteImport(candidates, `Shikimori (${res.n})`, `shiki_${res.n}_${candidates.length}`, false, null);
        }
      } catch (err) {
        toast('Онлайн-запрос не удался (' + err.message + '). Если Shikimori недоступен без VPN — используй кнопку загрузки XML/JSON файла.', true);
      }
    });
  };
}

// ---------- Навигация и поддержка кнопки «Назад» в браузере (History API) ----------
let _suppressHistoryPush = false;
function pushAppHistoryState(stateObj, replace = false) {
  if (_suppressHistoryPush) return;
  try {
    if (replace) history.replaceState(stateObj, '');
    else history.pushState(stateObj, '');
  } catch (e) {}
}

// ---------- Переключение 3 главных вкладок: 🌐 Каталог / 📚 Моя коллекция / 👤 Профиль ----------
function applyMainTabView(v, fromHistory = false) {
  const mode = (v === 'collection' || v === 'profile') ? v : 'catalog';
  const prevTab = document.querySelector('#mainTabs .tab.on')?.dataset.v || '';
  const wasFullPage = $('titlePageView')?.style.display === 'block';
  document.querySelectorAll('#mainTabs .tab').forEach(x => x.classList.toggle('on', x.dataset.v === mode));
  document.querySelectorAll('#botnav button').forEach(x => x.classList.toggle('on', x.dataset.go === mode));
  try { localStorage.setItem('lastTab', mode); } catch (e) {}
  if ($('titlePageView')) $('titlePageView').style.display = 'none';
  $('catalogView').style.display = mode === 'catalog' ? '' : 'none';
  $('profileView').style.display = (mode === 'profile' || mode === 'collection') ? '' : 'none';

  // Разграничиваем Профиль и Коллекцию по образцу Anixart:
  // В «👤 Профиль» показываем только карточку профиля, статистику по типам, диаграмму, историю и оценки.
  // В «📚 Моя коллекция» показываем папки, вкладки статусов, фильтры и список/сетку тайтлов.
  const shellEl = document.querySelector('.hyb-profile-shell');
  const extrasEl = $('profAnixartExtrasSec');
  const listsBlock = $('myListsBlock');
  const subtabsBar = document.querySelector('.hyb-subtabs-bar');
  const colWrap = $('profColWrap');
  const revBox = $('reviewItemsBox');
  const isCol = mode === 'collection';
  document.body.dataset.pview = mode;
  if (shellEl) shellEl.style.display = isCol ? 'none' : '';
  if (extrasEl) extrasEl.style.display = isCol ? 'none' : '';
  if (listsBlock) listsBlock.style.display = isCol ? '' : 'none';
  if (subtabsBar) subtabsBar.style.display = isCol ? '' : 'none';
  if (revBox) revBox.style.display = 'none';
  if (colWrap) colWrap.style.display = isCol ? '' : 'none';
  if (isCol) syncHybridStatusTabsUI();
  if (mode === 'catalog') cgMarks();
  if (!fromHistory && tabDone && (prevTab !== mode || wasFullPage)) {
    pushAppHistoryState({ tab: mode, fullPage: false });
  }
}

document.querySelectorAll('#mainTabs .tab').forEach(b => {
  b.onclick = () => applyMainTabView(b.dataset.v);
});

let tabDone = false;
function homeTab() {
  if (tabDone) return; tabDone = true;
  let t = ''; try { t = localStorage.getItem('lastTab'); } catch (e) {}
  if (!['catalog', 'collection', 'profile'].includes(t)) t = 'catalog';
  applyMainTabView(t, true);
  try {
    history.replaceState({ tab: t, fullPage: false }, '');
  } catch (e) {}
}

function refresh(opts = {}) {
  if (opts && opts.itemId != null) {
    updateSingleItemCardInDOM(opts.itemId);
    syncHybridStatusTabsUI();
    catCounts();
    cgMarks();
    renderAnixartHeroAndCategoryCards();
    renderAnixartProfileExtras();
    renderStatusAndCategoryBanner();
    return;
  }
  if (opts && opts.onlyList) {
    render(false);
    cgMarks();
    catCounts();
    renderAnixartHeroAndCategoryCards();
    renderAnixartProfileExtras();
    return;
  }
  refreshTags();
  refreshLists();
  render(false);
  profStats();
  cgMarks();
  catCounts();
  renderAnixartHeroAndCategoryCards();
  renderAnixartProfileExtras();
  updateProfileMetaAndPrivacyUI();
  renderStatusAndCategoryBanner();
  renderMyListsFolderBlock();
  updateLastImportBatchBarUI();
  if ($('reviewItemsBox')?.style.display !== 'none') renderReviewItemsTab();
  setTimeout(backupNudge, 4000);
}

// Синхронизация прокрутки и кнопки закрытия в модальных окнах
{
  const mods = [...document.querySelectorAll('.modal')]; let back = null;
  const sync = () => {
    const open = mods.find(m => m.style.display && m.style.display !== 'none');
    document.body.style.overflow = open ? 'hidden' : '';
    $('modalX').classList.toggle('show', !!open);
    if (open) {
      if (!back) back = document.activeElement;
      const curTab = document.querySelector('#mainTabs .tab.on')?.dataset.v || 'catalog';
      const isFull = $('titlePageView')?.style.display === 'block';
      const curTitleKey = history.state?.titleKey || '';
      const alreadyModalState = Boolean(history.state && history.state.modal);
      pushAppHistoryState({ tab: curTab, fullPage: isFull, titleKey: curTitleKey, modal: open.id }, alreadyModalState);
      const f = open.querySelector('input:not([type=hidden]),select,textarea,button');
      if (f) setTimeout(() => f.focus({preventScroll: true}), 30);
    } else if (back) {
      try { back.focus({preventScroll: true}); } catch (e) {}
      back = null;
    }
  };
  mods.forEach(m => new MutationObserver(sync).observe(m, {attributes: true, attributeFilter: ['style']}));
}
$('modalX').onclick = () => closeTopModal(false);
document.querySelectorAll('#accMenu .mi, #accMenu .mrow').forEach(n => n.addEventListener('click', e => e.stopPropagation()));
document.addEventListener('load', e => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);
document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);

// Индивидуальный фоллбэк постеров без глобального отключения прокси (_wsrvDown удалён)
document.addEventListener('error', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (!t.onerror && t.dataset.posterFailed !== '1' && t.src !== FALL) {
    handlePosterImgError(t, t.dataset.rawPoster || '', null);
  }
}, true);

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (_cloudSaveTimers.size) {
      const pendingFlush = [];
      _cloudSaveTimers.forEach((entry, docId) => {
        clearTimeout(entry.timer);
        const it = items.find(x => getCloudDocId(x) === docId);
        if (it) {
          it.dirty = true;
          pendingFlush.push(it);
        }
        entry.resolve();
      });
      _cloudSaveTimers.clear();

      if (pendingFlush.length && user && !user.isLocal && !(typeof isCloudWriteBlocked === 'function' && isCloudWriteBlocked())) {
        const b = writeBatch(db);
        pendingFlush.forEach(it => {
          const { docId, payload } = prepareTitleForCloud(it, user.uid);
          b.set(doc(db, 'items', docId), payload);
        });
        b.commit()
          .then(() => {
            pendingFlush.forEach(it => { delete it.dirty; });
            if (typeof flushLocalItemsNow === 'function') flushLocalItemsNow(false);
          })
          .catch(err => {
            if (typeof handleCloudError === 'function') handleCloudError(err, true);
          });
      }
    }
    if (typeof flushLocalItemsNow === 'function') flushLocalItemsNow(false);
    if (typeof profSaveLocal === 'function') profSaveLocal(true);
  }
});

if ($('restoreSafetyBackupBtn')) {
  $('restoreSafetyBackupBtn').onclick = async () => {
    if (!(await uiConfirm('Восстановить коллекцию из локальной страховочной копии браузера?\n\nЧто делает эта кнопка: загружает автоматически сохранённую резервную копию из памяти браузера (IndexedDB) в окно предпросмотра импорта и добавляет недостающие тайтлы без удаления текущих записей.', 'Подтвердить'))) return;
    const safetyKey = getUidStorageKey('safetyBackup');
    const localKey = getUidStorageKey('items');
    const pool = (await idbVault.get(safetyKey)) || (await idbVault.get(localKey)) || loadLocalItems();
    if (!Array.isArray(pool) || !pool.length) {
      return toast('В локальном кэше этого браузера резервных записей не найдено', true);
    }
    await previewAndExecuteImport(pool.map(fix), 'Страховочная копия браузера', '', false, null);
  };
}

window.addEventListener('popstate', e => {
  if (!user) return;
  _suppressHistoryPush = true;
  try {
    if ($('posterLightboxModal')?.classList.contains('open')) {
      closePosterLightbox();
      return;
    }
    if ($('qaFloatMenu')?.classList.contains('open')) {
      closeQuickAddStatusMenu();
      return;
    }
    const openMod = [...document.querySelectorAll('.modal')].find(m => m.style.display && m.style.display !== 'none');
    if (openMod && (!e.state || !e.state.modal)) {
      closeAll(true);
      return;
    }
    if (e.state && e.state.fullPage && e.state.titleKey) {
      const targetItem = _fullPageHistoryItems.get(e.state.titleKey) || items.find(i => String(i.id) === String(e.state.titleKey));
      if (targetItem) {
        openFullTitlePage(targetItem, true);
        return;
      }
    }
    if ($('titlePageView')?.style.display === 'block') {
      $('titlePageView').style.display = 'none';
    }
    const targetTab = (e.state && e.state.tab) || document.querySelector('#mainTabs .tab.on')?.dataset.v || 'catalog';
    applyMainTabView(targetTab, true);
  } finally {
    _suppressHistoryPush = false;
  }
});
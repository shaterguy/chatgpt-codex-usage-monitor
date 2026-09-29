"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const layout = require("../src/layout-core.js");

test("접힌 사이드바 폭을 축약형으로 분류한다", () => {
  assert.equal(layout.classifySidebarWidth(78), "collapsed");
  assert.equal(layout.classifySidebarWidth(layout.COLLAPSED_SIDEBAR_MAX_WIDTH), "collapsed");
});

test("펼친 사이드바 폭을 일반형으로 분류한다", () => {
  assert.equal(layout.classifySidebarWidth(121), "expanded");
  assert.equal(layout.classifySidebarWidth(260), "expanded");
});

test("측정 전의 잘못된 폭은 알 수 없음으로 분류한다", () => {
  assert.equal(layout.classifySidebarWidth(0), "unknown");
  assert.equal(layout.classifySidebarWidth(undefined), "unknown");
  assert.equal(layout.classifySidebarWidth("not-a-number"), "unknown");
});

test("숨겨진 tiny-bar 복제본보다 보이는 실제 사이드바 후보를 우선한다", () => {
  const tiny = { id: "tiny" };
  const expanded = { id: "expanded" };
  assert.equal(layout.selectSidebarAnchorCandidate([
    { element: tiny, connected: true, visible: false, insideTinyBar: true },
    { element: expanded, connected: true, visible: true, insideTinyBar: false }
  ]), expanded);
});

test("접힌 사이드바에서는 보이는 tiny-bar 후보를 사용할 수 있다", () => {
  const tiny = { id: "tiny" };
  assert.equal(layout.selectSidebarAnchorCandidate([
    { element: tiny, connected: true, visible: true, insideTinyBar: true }
  ]), tiny);
});

test("SPA 교체 뒤 연결이 끊긴 기존 후보 대신 새 후보를 선택한다", () => {
  const stale = { id: "stale" };
  const replacement = { id: "replacement" };
  assert.equal(layout.selectSidebarAnchorCandidate([
    { element: stale, connected: false, visible: true, insideTinyBar: false },
    { element: replacement, connected: true, visible: true, insideTinyBar: false }
  ]), replacement);
});

test("사용 가능한 사이드바 후보가 없으면 null을 반환한다", () => {
  assert.equal(layout.selectSidebarAnchorCandidate([
    { element: { id: "hidden" }, connected: true, visible: false, insideTinyBar: false }
  ]), null);
});

test("New chat data-testid 선택자는 태그 종류와 무관하게 동작한다", () => {
  assert.ok(layout.NEW_CHAT_SELECTORS.includes("[data-testid='create-new-chat-button']"));
  assert.ok(layout.NEW_CHAT_SELECTORS.includes("[data-testid='new-chat-button']"));
  assert.ok(!layout.NEW_CHAT_SELECTORS.some((selector) => selector.startsWith("button[data-testid=")));
});

test("일시적인 앵커 탐색 실패 중 현재 통합 마운트가 유효하면 유지한다", () => {
  assert.equal(layout.shouldKeepIntegratedMount({
    layoutMode: "integrated",
    hostConnected: true,
    parentConnected: true,
    sidebarConnected: true,
    hostInsideSidebar: true
  }), true);
});

test("SPA 교체로 기존 사이드바 연결이 끊기면 현재 통합 마운트를 유지하지 않는다", () => {
  assert.equal(layout.shouldKeepIntegratedMount({
    layoutMode: "integrated",
    hostConnected: true,
    parentConnected: true,
    sidebarConnected: false,
    hostInsideSidebar: false
  }), false);
});

test("호스트 부모가 분리되면 연결된 것처럼 보여도 현재 통합 마운트를 유지하지 않는다", () => {
  assert.equal(layout.shouldKeepIntegratedMount({
    layoutMode: "integrated",
    hostConnected: true,
    parentConnected: false,
    sidebarConnected: true,
    hostInsideSidebar: true
  }), false);
});

test("초기 hidden 상태는 통합 마운트 유지 대상으로 보지 않는다", () => {
  assert.equal(layout.shouldKeepIntegratedMount({
    layoutMode: "hidden",
    hostConnected: true,
    parentConnected: true,
    sidebarConnected: true,
    hostInsideSidebar: true
  }), false);
});

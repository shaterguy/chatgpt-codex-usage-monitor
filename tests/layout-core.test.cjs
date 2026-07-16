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

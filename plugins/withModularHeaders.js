/**
 * Expo config plugin: two complementary Podfile patches to fix
 * @react-native-firebase + `useFrameworks: 'static'` build errors on iOS.
 *
 * Patch 1: insert `use_modular_headers!` INSIDE the target block,
 *          right after `use_frameworks!`. Forces every pod to expose
 *          its headers as a Clang module.
 *
 * Patch 2: add a `post_install` build-setting hook that sets
 *          `CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES = YES`
 *          on every pod target. This is the actual workaround that
 *          fixes this specific RNFB-on-static-framework error —
 *          `use_modular_headers!` alone does NOT propagate to React-Core
 *          in Expo SDK 54's autolinking setup, so the `-Werror` flag
 *          still trips. The build setting silences it at the source.
 *
 * Why this is needed:
 *   When `useFrameworks: 'static'` is set, RNFB compiles itself as a
 *   static framework. Static frameworks cannot include non-modular
 *   headers (Clang errors with -Wnon-modular-include-in-framework-module).
 *   React-Core's headers are non-modular under Expo SDK 54's autolinking,
 *   producing errors like:
 *     "include of non-modular header inside framework module
 *      'RNFBApp.RCTConvert_FIRApp': React/RCTConvert.h"
 *
 * History (don't repeat):
 *   - v1 of this plugin inserted `use_modular_headers!` at the top of
 *     the Podfile, OUTSIDE the target block. CocoaPods ignored it.
 *   - v2 moved it INSIDE the target after `use_frameworks!`. Plugin
 *     reported success but RNFBApp still failed identically — the
 *     directive doesn't propagate to React-Core in this setup.
 *   - v3 (this version) keeps `use_modular_headers!` AND adds a
 *     post_install hook with the Xcode build setting that actually
 *     suppresses the warning-as-error.
 *
 * Why a custom plugin:
 *   `expo-build-properties` doesn't expose Podfile post_install hooks
 *   or this build setting.
 *
 * Idempotent: each patch checks for its own marker before applying.
 * Fails loudly during prebuild if anchors aren't found.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'use_modular_headers!';
const POST_INSTALL_MARKER =
  '# [withModularHeaders] CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES';

// Match the `use_frameworks!` line (with any args, e.g.
// `use_frameworks! :linkage => :static`) and capture its leading
// indentation so the inserted line keeps the same indent.
const USE_FRAMEWORKS_RE = /^([ \t]*)(use_frameworks![^\n]*)$/m;

// Match `post_install do |installer|` opening line (Expo's Podfile
// always has one for react_native_post_install).
const POST_INSTALL_RE = /^([ \t]*)(post_install do \|installer\|)$/m;

const BUILD_SETTING_SNIPPET = (indent) =>
  [
    `${indent}  ${POST_INSTALL_MARKER}`,
    `${indent}  # Patch A: allow non-modular header includes inside framework`,
    `${indent}  # modules. Fixes Clang -Wnon-modular-include errors when`,
    `${indent}  # @react-native-firebase Obj-C code includes React-Core headers.`,
    `${indent}  #`,
    `${indent}  # Patch B: define a Swift-importable module on React-* / RCT-*`,
    `${indent}  # pods so RNFBFirestore's Swift code can resolve them.`,
    `${indent}  #`,
    `${indent}  # IMPORTANT: with use_frameworks!, recent CocoaPods puts each pod`,
    `${indent}  # in its OWN subproject (installer.pod_target_subprojects), not`,
    `${indent}  # in installer.pods_project. Iterating only pods_project silently`,
    `${indent}  # skips RNFB pods \u2014 we learned this the painful way. Iterate`,
    `${indent}  # every target across every project to be safe.`,
    `${indent}  all_projects = []`,
    `${indent}  all_projects << installer.pods_project if installer.pods_project`,
    `${indent}  if installer.respond_to?(:pod_target_subprojects)`,
    `${indent}    all_projects.concat(installer.pod_target_subprojects)`,
    `${indent}  end`,
    `${indent}  if installer.respond_to?(:generated_projects)`,
    `${indent}    all_projects.concat(installer.generated_projects)`,
    `${indent}  end`,
    `${indent}  all_projects.uniq.each do |project|`,
    `${indent}    project.targets.each do |target|`,
    `${indent}      is_react_pod = target.name.start_with?('React') || target.name.start_with?('RCT')`,
    `${indent}      target.build_configurations.each do |config|`,
    `${indent}        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'`,
    `${indent}        if is_react_pod`,
    `${indent}          config.build_settings['DEFINES_MODULE'] = 'YES'`,
    `${indent}        end`,
    `${indent}      end`,
    `${indent}    end`,
    `${indent}  end`,
    `${indent}  Pod::UI.puts "[withModularHeaders] applied build settings to #{all_projects.uniq.length} project(s)"`,
  ].join('\n');

const withModularHeaders = config =>
  withDangerousMod(config, [
    'ios',
    async cfg => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'Podfile',
      );
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      // Patch 1: use_modular_headers! after use_frameworks!
      if (!podfile.includes(MARKER)) {
        const match = USE_FRAMEWORKS_RE.exec(podfile);
        if (!match) {
          throw new Error(
            '[withModularHeaders] could not find `use_frameworks!` in Podfile. ' +
              'Make sure expo-build-properties has `ios.useFrameworks: "static"` ' +
              'configured before this plugin runs.',
          );
        }
        const indent = match[1];
        podfile = podfile.replace(
          USE_FRAMEWORKS_RE,
          `${indent}$2\n${indent}${MARKER}`,
        );
        console.log(
          `[withModularHeaders] inserted ${MARKER} after use_frameworks!`,
        );
      } else {
        console.log(
          '[withModularHeaders] use_modular_headers! already present — skipping patch 1',
        );
      }

      // Patch 2: post_install build setting hook
      if (!podfile.includes(POST_INSTALL_MARKER)) {
        const match = POST_INSTALL_RE.exec(podfile);
        if (!match) {
          throw new Error(
            '[withModularHeaders] could not find `post_install do |installer|` in Podfile. ' +
              'Expo template should always include this hook — manual edit needed.',
          );
        }
        const indent = match[1];
        podfile = podfile.replace(
          POST_INSTALL_RE,
          `${indent}$2\n${BUILD_SETTING_SNIPPET(indent)}`,
        );
        console.log(
          '[withModularHeaders] injected CLANG_ALLOW_NON_MODULAR_INCLUDES build setting in post_install',
        );
      } else {
        console.log(
          '[withModularHeaders] build setting already present — skipping patch 2',
        );
      }

      fs.writeFileSync(podfilePath, podfile);
      return cfg;
    },
  ]);

module.exports = withModularHeaders;

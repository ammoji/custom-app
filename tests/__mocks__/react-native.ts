// Minimal RN stub for unit tests. Platform state is held on
// globalThis so it survives jest.isolateModules() — the SUT loads
// a fresh copy of this mock inside the isolated registry, but the
// getter still reads from the same global slot the test wrote to.
//
// Tests set Platform.OS before invoking the SUT loader:
//   const { Platform } = require('react-native');
//   Platform.OS = 'ios';
const G = globalThis as any;
if (G.__rn_platform_os == null) G.__rn_platform_os = 'web';

export const Platform = {
  get OS(): 'ios' | 'android' | 'web' {
    return G.__rn_platform_os;
  },
  set OS(v: 'ios' | 'android' | 'web') {
    G.__rn_platform_os = v;
  },
};

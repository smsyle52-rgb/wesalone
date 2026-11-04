import { getBrandLogo } from './brand-mark';

describe('getBrandLogo', () => {
  it('returns the bundled logo for the Wesal One brand', () => {
    expect(getBrandLogo('wesalone')).not.toBeNull();
  });

  it('falls back to no logo for brands without one', () => {
    expect(getBrandLogo('chatbotx')).toBeNull();
    expect(getBrandLogo('unknown')).toBeNull();
  });
});

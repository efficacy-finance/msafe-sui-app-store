import { CetusIntention } from '@/apps/cetus/intention';

describe('Cetus App', () => {
  it('Test Cetus intention serialization', () => {
    const intention = CetusIntention.fromData({
      content:
        '0000020008809698000000000000206a7da68260ca5bb32ed0dde656b3ad75c82f7b24504f487739aa76221a2d5e0b020200010100000101030000000001010049b6326662c7d89f3c8b27a86c704aed49b5c31219807caede29ead1bc0d77330124ec714a812d09559e480914f14077ffbf752bb2daa440af5c7b784d7fea8f464ed6a10400000000203f7a21752221628469f96ad7c9aa3602744c011e966f5996f619f2a55360b4a849b6326662c7d89f3c8b27a86c704aed49b5c31219807caede29ead1bc0d7733ee02000000000000200a35000000000000',
    });

    expect(intention.serialize()).toBe(
      '{"content":"0000020008809698000000000000206a7da68260ca5bb32ed0dde656b3ad75c82f7b24504f487739aa76221a2d5e0b020200010100000101030000000001010049b6326662c7d89f3c8b27a86c704aed49b5c31219807caede29ead1bc0d77330124ec714a812d09559e480914f14077ffbf752bb2daa440af5c7b784d7fea8f464ed6a10400000000203f7a21752221628469f96ad7c9aa3602744c011e966f5996f619f2a55360b4a849b6326662c7d89f3c8b27a86c704aed49b5c31219807caede29ead1bc0d7733ee02000000000000200a35000000000000"}',
    );
  });
});
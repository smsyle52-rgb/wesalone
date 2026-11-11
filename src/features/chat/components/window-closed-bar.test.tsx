import { fireEvent, render, screen } from '@testing-library/react-native';

import { WindowClosedBar } from './window-closed-bar';

describe('WindowClosedBar', () => {
  it('explains the closed window and offers a flow', async () => {
    const onSendFlow = jest.fn();
    await render(<WindowClosedBar onSendFlow={onSendFlow} />);

    expect(screen.getByText('chat.windowClosedBanner')).toBeTruthy();
    fireEvent.press(screen.getByText('chat.sendFlow'));
    expect(onSendFlow).toHaveBeenCalledTimes(1);
  });
});

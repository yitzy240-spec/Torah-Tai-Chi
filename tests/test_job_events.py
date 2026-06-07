# tests/test_job_events.py
import os
from unittest.mock import patch, MagicMock
from src.job_events import emit_job_event

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
    'VERCEL_DONE_WEBHOOK_URL': 'https://example.com/api/jobs/done',
    'MODAL_WEBHOOK_SECRET': 'secret-xyz',
})
@patch('src.job_events.httpx.post')
def test_non_terminal_publishes_broadcast_only(mock_post):
    mock_post.return_value = MagicMock(status_code=200, text='ok')
    emit_job_event(job_id='J1', stage='clip_done', clip_index=3, total_clips=8)
    # Should have called Supabase Broadcast endpoint (one POST), NOT the
    # Vercel terminal endpoint.
    urls = [call.args[0] for call in mock_post.call_args_list]
    assert any('supabase.co' in u for u in urls)
    assert not any('example.com/api/jobs/done' in u for u in urls)

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
    'VERCEL_DONE_WEBHOOK_URL': 'https://example.com/api/jobs/done',
    'MODAL_WEBHOOK_SECRET': 'secret-xyz',
})
@patch('src.job_events.httpx.post')
def test_terminal_publishes_broadcast_AND_done_webhook(mock_post):
    mock_post.return_value = MagicMock(status_code=200, text='ok')
    emit_job_event(job_id='J1', stage='done', video_path='videos/J1.mp4')
    urls = [call.args[0] for call in mock_post.call_args_list]
    assert any('supabase.co' in u for u in urls)
    assert any('example.com/api/jobs/done' in u for u in urls)

@patch.dict(os.environ, {}, clear=True)
def test_emit_no_op_when_env_missing():
    emit_job_event(job_id='J1', stage='done')  # must not raise

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
})
@patch('src.job_events.httpx.post', side_effect=Exception('network down'))
def test_emit_swallows_network_errors(mock_post):
    emit_job_event(job_id='J1', stage='done')  # must not raise

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
    'VERCEL_DONE_WEBHOOK_URL': 'https://example.com/api/jobs/done',
    'MODAL_WEBHOOK_SECRET': 'secret-xyz',
})
@patch('src.job_events.httpx.post')
def test_done_without_video_path_skips_email(mock_post):
    """plan-only / closure-emit 'done' without video_path should NOT email."""
    mock_post.return_value = MagicMock(status_code=200, text='ok')
    emit_job_event(job_id='J1', stage='done', message='Plan ready')
    urls = [call.args[0] for call in mock_post.call_args_list]
    assert any('supabase.co' in u for u in urls), 'broadcast still publishes'
    assert not any('example.com/api/jobs/done' in u for u in urls), \
        'no email when done has no video_path'

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
    'VERCEL_DONE_WEBHOOK_URL': 'https://example.com/api/jobs/done',
    'MODAL_WEBHOOK_SECRET': 'secret-xyz',
})
@patch('src.job_events.httpx.post')
def test_failed_without_video_path_still_emails(mock_post):
    """failed/cancelled MUST still email even without video_path."""
    mock_post.return_value = MagicMock(status_code=200, text='ok')
    emit_job_event(job_id='J1', stage='failed', message='Pipeline crashed')
    urls = [call.args[0] for call in mock_post.call_args_list]
    assert any('example.com/api/jobs/done' in u for u in urls), \
        'failed still emails'

import base64
import json
from time import time
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.parse import quote
from urllib.parse import urlencode
from urllib.request import Request
from urllib.request import urlopen

import jwt
from pydantic import AnyUrl
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import EmailStr
from pydantic import Field
from pydantic import SecretStr

from app.services.email.provider_invites import ProviderInviteEmailMessage
from app.services.email.provider_invites import ProviderInviteEmailSendResult
from app.services.email.provider_invites import provider_invite_mime_message
from app.services.email.provider_invites import sent_provider_invite_result

GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1"
GMAIL_JWT_LIFETIME_SECONDS = 3600


class GmailSendError(Exception):
    pass


class GmailServiceAccountCredentials(BaseModel):
    client_email: EmailStr
    private_key: SecretStr
    token_uri: AnyUrl


class GmailJwtClaims(BaseModel):
    iss: str
    scope: str
    aud: str
    sub: str
    iat: int
    exp: int


class GmailTokenRequest(BaseModel):
    grant_type: str
    assertion: str


class GmailAccessTokenResponse(BaseModel):
    access_token: SecretStr
    expires_in: int
    token_type: str


class GmailMessageSendRequest(BaseModel):
    raw: str


class GmailMessageSendResponse(BaseModel):
    id: str
    thread_id: str | None = Field(default=None, alias="threadId")

    model_config = ConfigDict(populate_by_name=True)


class GmailProviderInviteEmailSender:
    def __init__(
        self,
        service_account_json: str,
        sender_email: str,
    ) -> None:
        service_account_payload = json.loads(service_account_json)
        self.service_account = GmailServiceAccountCredentials.model_validate(service_account_payload)
        self.sender_email = sender_email

    def send_provider_invite(
        self,
        message: ProviderInviteEmailMessage,
    ) -> ProviderInviteEmailSendResult:
        access_token_response = self.access_token_response()
        gmail_response = self.send_gmail_message(message, access_token_response)
        result = sent_provider_invite_result(gmail_response.id)
        return result

    def access_token_response(self) -> GmailAccessTokenResponse:
        assertion = self.signed_jwt_assertion()
        token_request = GmailTokenRequest(
            grant_type="urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion=assertion,
        )
        token_response = self.execute_access_token_request(token_request)
        return token_response

    def signed_jwt_assertion(self) -> str:
        issued_at = int(time())
        expires_at = issued_at + GMAIL_JWT_LIFETIME_SECONDS
        claims = GmailJwtClaims(
            iss=str(self.service_account.client_email),
            scope=GMAIL_SEND_SCOPE,
            aud=str(self.service_account.token_uri),
            sub=self.sender_email,
            iat=issued_at,
            exp=expires_at,
        )
        private_key = self.service_account.private_key.get_secret_value()
        assertion = jwt.encode(claims.model_dump(), private_key, algorithm="RS256")
        return assertion

    def execute_access_token_request(
        self,
        token_request: GmailTokenRequest,
    ) -> GmailAccessTokenResponse:
        request_body = urlencode(token_request.model_dump()).encode("utf-8")
        request_headers = {
            "Content-Type": "application/x-www-form-urlencoded",
        }
        request = Request(
            str(self.service_account.token_uri),
            data=request_body,
            headers=request_headers,
        )
        response_json = self.execute_json_request(request)
        token_response = GmailAccessTokenResponse.model_validate(response_json)
        return token_response

    def send_gmail_message(
        self,
        message: ProviderInviteEmailMessage,
        access_token_response: GmailAccessTokenResponse,
    ) -> GmailMessageSendResponse:
        raw_message = self.encoded_raw_message(message)
        send_request = GmailMessageSendRequest(raw=raw_message)
        request_body = send_request.model_dump_json().encode("utf-8")
        access_token = access_token_response.access_token.get_secret_value()
        request_headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        quoted_sender_email = quote(self.sender_email, safe="")
        request_url = f"{GMAIL_API_BASE_URL}/users/{quoted_sender_email}/messages/send"
        request = Request(request_url, data=request_body, headers=request_headers)
        response_json = self.execute_json_request(request)
        send_response = GmailMessageSendResponse.model_validate(response_json)
        return send_response

    def encoded_raw_message(self, message: ProviderInviteEmailMessage) -> str:
        mime_message = provider_invite_mime_message(message)
        mime_bytes = mime_message.as_bytes()
        encoded_bytes = base64.urlsafe_b64encode(mime_bytes)
        encoded_message = encoded_bytes.decode("utf-8")
        return encoded_message

    def execute_json_request(self, request: Request) -> object:
        try:
            with urlopen(request, timeout=20) as response:
                response_body = response.read()
        except HTTPError as error:
            error_body = error.read().decode("utf-8")
            raise GmailSendError(error_body) from error
        except URLError as error:
            error_reason = str(error.reason)
            raise GmailSendError(error_reason) from error

        response_text = response_body.decode("utf-8")
        response_json = json.loads(response_text)
        return response_json

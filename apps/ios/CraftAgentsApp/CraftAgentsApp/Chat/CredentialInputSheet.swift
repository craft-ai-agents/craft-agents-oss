// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/CredentialInputSheet.swift
import SwiftUI
import CraftAgentKit

/// Prompts for a credential in response to a `credential_request` session event
/// and returns a `CredentialResponse` (or a cancellation) to the caller.
struct CredentialInputSheet: View {
    let request: CredentialRequest
    let onRespond: (CredentialResponse) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var value = ""
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let description = request.description {
                        Text(description).font(.callout)
                    }
                    if let hint = request.hint {
                        Text(hint).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section {
                    if request.isBasicAuth {
                        TextField("Username", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Password", text: $password)
                    } else {
                        SecureField(secureFieldLabel, text: $value)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
            }
            .navigationTitle(request.sourceName ?? "Credential")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onRespond(CredentialResponse(cancelled: true))
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        onRespond(response)
                        dismiss()
                    }
                    .disabled(!isValid)
                }
            }
        }
    }

    private var secureFieldLabel: String {
        switch request.mode {
        case "bearer": return "Token"
        case "api_key": return "API Key"
        default: return "Value"
        }
    }

    private var isValid: Bool {
        if request.isBasicAuth {
            return !username.isEmpty && (!(request.passwordRequired ?? true) || !password.isEmpty)
        }
        return !value.isEmpty
    }

    private var response: CredentialResponse {
        if request.isBasicAuth {
            return CredentialResponse(username: username, password: password, cancelled: false)
        }
        return CredentialResponse(value: value, cancelled: false)
    }
}

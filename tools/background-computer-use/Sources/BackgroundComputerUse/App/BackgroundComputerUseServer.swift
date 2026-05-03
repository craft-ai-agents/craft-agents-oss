import Foundation

package enum BackgroundComputerUseServer {
    package static func run() {
        AppKitRuntimeBootstrap.startIfNeeded()

        let bootstrap = RuntimeBootstrap()
        let semaphore = DispatchSemaphore(value: 0)
        let resultBox = RuntimeBootResultBox()

        Task.detached {
            do {
                resultBox.result = .success(try await bootstrap.start())
            } catch {
                resultBox.result = .failure(error)
            }
            semaphore.signal()
        }

        semaphore.wait()

        do {
            let state = try resultBox.unwrapped()
            print("BackgroundComputerUse running at \(state.baseURL.absoluteString)")
            print("Runtime manifest: \(state.manifestPath)")
            AppKitRuntimeBootstrap.runEventLoop()
        } catch {
            fputs("BackgroundComputerUse failed to start: \(error)\n", stderr)
            Foundation.exit(1)
        }
    }
}

private final class RuntimeBootResultBox: @unchecked Sendable {
    var result: Result<RuntimeBootState, Error>?

    func unwrapped() throws -> RuntimeBootState {
        switch result {
        case .success(let state):
            return state
        case .failure(let error):
            throw error
        case .none:
            throw RuntimeBootResultError.missingResult
        }
    }
}

private enum RuntimeBootResultError: Error {
    case missingResult
}

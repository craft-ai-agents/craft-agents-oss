import AppKit
import ApplicationServices
import Foundation

private let maxExtractedTextLength = 900

struct AXTextExtractionService {
    private static var selectedTextAttribute: CFString { "AXSelectedText" as CFString }
    private static var selectedTextMarkerRangeAttribute: CFString { "AXSelectedTextMarkerRange" as CFString }
    private static var visibleCharacterRangeAttribute: CFString { "AXVisibleCharacterRange" as CFString }
    private static var stringForRangeParameterizedAttribute: CFString { "AXStringForRange" as CFString }
    private static var attributedStringForRangeParameterizedAttribute: CFString { "AXAttributedStringForRange" as CFString }
    private static var stringForTextMarkerRangeParameterizedAttribute: CFString { "AXStringForTextMarkerRange" as CFString }
    private static var attributedStringForTextMarkerRangeParameterizedAttribute: CFString { "AXAttributedStringForTextMarkerRange" as CFString }

    func extract(
        from element: AXUIElement,
        role: String?,
        parameterizedAttributeNames: Set<String>? = nil
    ) -> AXTextExtractionDTO? {
        let parameterizedAttributeNames = parameterizedAttributeNames ?? Set(AXHelpers.parameterizedAttributeNames(element))
        let supportsTextMarkers =
            parameterizedAttributeNames.contains(Self.stringForTextMarkerRangeParameterizedAttribute as String) ||
            parameterizedAttributeNames.contains(Self.attributedStringForTextMarkerRangeParameterizedAttribute as String)

        let selectedPlainText = ProjectionTextSupport.cleaned(
            AXHelpers.stringAttribute(element, attribute: Self.selectedTextAttribute)
        )
        let selectedMarkerRange = AXHelpers.copyAttributeValue(element, attribute: Self.selectedTextMarkerRangeAttribute)
        let selectedMarkerText = extractTextMarkerText(
            from: element,
            parameterizedAttributeNames: parameterizedAttributeNames,
            markerRange: selectedMarkerRange
        )
        let visibleRangeText = extractVisibleRangeText(
            from: element,
            parameterizedAttributeNames: parameterizedAttributeNames
        )

        let availableModes = availableModes(
            selectedPlainText: selectedPlainText,
            selectedMarkerText: selectedMarkerText,
            visibleRangeText: visibleRangeText
        )
        guard availableModes.isEmpty == false else {
            return nil
        }

        let source: String
        let mode: String
        let bestText: String?
        let bestAttributedText: String?
        if let attributedText = visibleRangeText.attributedText ?? visibleRangeText.text {
            source = visibleRangeText.source
            mode = role == "AXWebArea"
                ? (visibleRangeText.attributedText != nil ? "web-attributed-text" : "web-visible-text")
                : visibleRangeText.mode
            bestText = attributedText
            bestAttributedText = visibleRangeText.attributedText
        } else if let selectedAttributed = selectedMarkerText.attributedText ?? selectedMarkerText.text {
            source = selectedMarkerText.source
            mode = selectedMarkerText.mode
            bestText = selectedAttributed
            bestAttributedText = selectedMarkerText.attributedText
        } else {
            source = "selected-text"
            mode = "selection-only"
            bestText = selectedPlainText
            bestAttributedText = nil
        }

        let selectedPreferredText = selectedMarkerText.attributedText ?? selectedMarkerText.text ?? selectedPlainText
        let truncatedText = truncated(bestText)
        let truncatedAttributedText = truncated(bestAttributedText)
        let truncatedSelectedText = truncated(selectedPreferredText)
        let truncatedSelectedAttributedText = truncated(selectedMarkerText.attributedText)

        return AXTextExtractionDTO(
            source: source,
            mode: mode,
            availableModes: availableModes,
            text: truncatedText.text,
            attributedText: truncatedAttributedText.text,
            selectedText: truncatedSelectedText.text,
            selectedAttributedText: truncatedSelectedAttributedText.text,
            length: bestText?.count,
            truncated: truncatedText.truncated ||
                truncatedAttributedText.truncated ||
                truncatedSelectedText.truncated ||
                truncatedSelectedAttributedText.truncated,
            supportsTextMarkers: supportsTextMarkers,
            supportedParameterizedAttributes: parameterizedAttributeNames.sorted()
        )
    }

    private func extractVisibleRangeText(
        from element: AXUIElement,
        parameterizedAttributeNames: Set<String>
    ) -> ExtractionCandidate {
        guard let rangeValue = AXHelpers.copyAttributeValue(element, attribute: Self.visibleCharacterRangeAttribute),
              let range = AXHelpers.rangeValue(from: rangeValue),
              range.length > 0 else {
            return .empty
        }

        guard let parameter = AXHelpers.axValue(for: range) else {
            return .empty
        }

        let attributedText = parameterizedAttributeNames.contains(Self.attributedStringForRangeParameterizedAttribute as String)
            ? extractAttributedText(
                from: element,
                attribute: Self.attributedStringForRangeParameterizedAttribute,
                parameter: parameter
            )
            : nil
        let plainText = parameterizedAttributeNames.contains(Self.stringForRangeParameterizedAttribute as String)
            ? extractPlainText(
                from: element,
                attribute: Self.stringForRangeParameterizedAttribute,
                parameter: parameter
            )
            : nil

        return ExtractionCandidate(
            source: attributedText != nil ? "attributed-visible-range" : "visible-character-range",
            mode: attributedText != nil ? "attributed-visible-text" : "visible-text",
            text: attributedText ?? plainText,
            attributedText: attributedText
        )
    }

    private func extractTextMarkerText(
        from element: AXUIElement,
        parameterizedAttributeNames: Set<String>,
        markerRange: CFTypeRef?
    ) -> ExtractionCandidate {
        guard let markerRange else {
            return .empty
        }

        let attributedText = parameterizedAttributeNames.contains(Self.attributedStringForTextMarkerRangeParameterizedAttribute as String)
            ? extractAttributedText(
                from: element,
                attribute: Self.attributedStringForTextMarkerRangeParameterizedAttribute,
                parameter: markerRange
            )
            : nil
        let plainText = parameterizedAttributeNames.contains(Self.stringForTextMarkerRangeParameterizedAttribute as String)
            ? extractPlainText(
                from: element,
                attribute: Self.stringForTextMarkerRangeParameterizedAttribute,
                parameter: markerRange
            )
            : nil

        return ExtractionCandidate(
            source: attributedText != nil ? "selected-text-marker-range-attributed" : "selected-text-marker-range",
            mode: attributedText != nil ? "selected-text-marker-markdown" : "selected-text-marker-text",
            text: attributedText ?? plainText,
            attributedText: attributedText
        )
    }

    private func extractPlainText(
        from element: AXUIElement,
        attribute: CFString,
        parameter: CFTypeRef
    ) -> String? {
        guard let rawValue = AXHelpers.copyParameterizedAttributeValue(
            element,
            attribute: attribute,
            parameter: parameter
        ) else {
            return nil
        }

        if let text = rawValue as? String {
            return ProjectionTextSupport.cleaned(text)
        }
        return nil
    }

    private func extractAttributedText(
        from element: AXUIElement,
        attribute: CFString,
        parameter: CFTypeRef
    ) -> String? {
        guard let rawValue = AXHelpers.copyParameterizedAttributeValue(
            element,
            attribute: attribute,
            parameter: parameter
        ) else {
            return nil
        }

        if let attributedString = rawValue as? NSAttributedString {
            return ProjectionTextSupport.cleaned(markdownText(from: attributedString))
        }
        return nil
    }

    private func markdownText(from attributedString: NSAttributedString) -> String {
        guard attributedString.length > 0 else {
            return ""
        }

        var segments: [String] = []
        attributedString.enumerateAttributes(
            in: NSRange(location: 0, length: attributedString.length),
            options: []
        ) { attributes, range, _ in
            let rawText = attributedString.attributedSubstring(from: range).string
            let cleanedText = ProjectionTextSupport.cleaned(rawText) ?? rawText
            guard cleanedText.isEmpty == false else {
                return
            }

            var renderedText = cleanedText
            if let link = attributes[.link] {
                let destination = String(describing: link)
                renderedText = "[\(renderedText)](\(destination))"
            }

            let fontTraits = fontTraits(from: attributes[.font])
            let isBold = fontTraits.contains(.boldFontMask)
            let isItalic = fontTraits.contains(.italicFontMask)
            let isUnderlined = underlineStyle(from: attributes[.underlineStyle]) > 0
            let isStruck = underlineStyle(from: attributes[.strikethroughStyle]) > 0

            if isBold {
                renderedText = "**\(renderedText)**"
            }
            if isItalic {
                renderedText = "_\(renderedText)_"
            }
            if isUnderlined {
                renderedText = "<u>\(renderedText)</u>"
            }
            if isStruck {
                renderedText = "~~\(renderedText)~~"
            }

            segments.append(renderedText)
        }

        return segments.joined()
            .replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
    }

    private func fontTraits(from rawFont: Any?) -> NSFontTraitMask {
        guard let font = rawFont as? NSFont else {
            return []
        }
        return NSFontManager.shared.traits(of: font)
    }

    private func underlineStyle(from rawValue: Any?) -> Int {
        if let value = rawValue as? NSNumber {
            return value.intValue
        }
        return 0
    }

    private func availableModes(
        selectedPlainText: String?,
        selectedMarkerText: ExtractionCandidate,
        visibleRangeText: ExtractionCandidate
    ) -> [String] {
        var modes: [String] = []
        if visibleRangeText.text != nil {
            modes.append(visibleRangeText.mode)
        }
        if selectedMarkerText.text != nil {
            modes.append(selectedMarkerText.mode)
        }
        if selectedPlainText != nil {
            modes.append("selection-only")
        }
        return modes
    }

    private func truncated(_ text: String?) -> (text: String?, truncated: Bool) {
        guard let text else {
            return (nil, false)
        }
        guard text.count > maxExtractedTextLength else {
            return (text, false)
        }
        return (String(text.prefix(maxExtractedTextLength)), true)
    }
}

private struct ExtractionCandidate {
    let source: String
    let mode: String
    let text: String?
    let attributedText: String?

    static let empty = ExtractionCandidate(
        source: "none",
        mode: "none",
        text: nil,
        attributedText: nil
    )
}

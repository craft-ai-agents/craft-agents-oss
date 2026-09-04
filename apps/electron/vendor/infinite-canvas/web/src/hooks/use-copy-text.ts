import { App } from "antd";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

export function useCopyText() {
    const { message } = App.useApp();
    const { t } = useTranslation();

    return (value: string, successText = t("common.copied")) => {
        copy(value);
        message.success(successText);
    };
}
